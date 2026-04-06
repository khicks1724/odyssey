#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('../../server/node_modules/@supabase/supabase-js');

const TABLES = [
  'profiles',
  'projects',
  'project_members',
  'integrations',
  'project_labels',
  'project_prompts',
  'project_insights',
  'goals',
  'goal_dependencies',
  'goal_comments',
  'goal_reports',
  'goal_attachments',
  'events',
  'saved_reports',
  'standup_reports',
  'time_logs',
  'time_periods',
  'qr_invite_tokens',
  'join_requests',
  'notifications',
  'chat_threads',
  'chat_thread_members',
  'chat_messages',
  'project_financials',
  'user_connections',
  'user_ai_keys',
];

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    env[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return env;
}

function randomPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

async function upsertRows(supabase, table, rows) {
  if (!rows.length) return;
  const chunkSize = 250;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function clearTable(supabase, table, filterColumn) {
  const { error } = await supabase.from(table).delete().not(filterColumn, 'is', null);
  if (error) throw new Error(`clear ${table}: ${error.message}`);
}

async function ensureUsers(supabase, users, reportPath) {
  const report = [];
  const identityReport = [];
  for (const user of users) {
    const userExistsPattern = /already exists|already been registered|already registered/i;
    const createPayload = {
      id: user.id,
      email: user.email,
      phone: user.phone || undefined,
      email_confirm: Boolean(user.email_confirmed_at || user.confirmed_at),
      phone_confirm: Boolean(user.phone_confirmed_at),
      user_metadata: user.user_metadata || {},
      app_metadata: user.app_metadata || {},
      role: user.role || 'authenticated',
      ban_duration: user.banned_until ? '876000h' : 'none',
    };

    if (user.password_hash) {
      createPayload.password_hash = user.password_hash;
    } else {
      createPayload.password = randomPassword();
      report.push({
        id: user.id,
        email: user.email,
        temporaryPassword: createPayload.password,
        note: 'Original password hash was not available from the service-role export. Reset after first sign-in if needed.',
      });
    }

    const { error } = await supabase.auth.admin.createUser(createPayload);
    if (error && !userExistsPattern.test(error.message)) {
      throw new Error(`auth user ${user.email || user.id}: ${error.message}`);
    }

    if (error && userExistsPattern.test(error.message)) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, createPayload);
      if (updateError) {
        throw new Error(`auth user ${user.email || user.id}: ${updateError.message}`);
      }
    }

    const identities = Array.isArray(user.identities) ? user.identities : [];
    if (identities.length > 0) {
      identityReport.push({
        id: user.id,
        email: user.email,
        providers: identities.map((identity) => ({
          provider: identity.provider,
          identity_id: identity.identity_id,
          email: identity.identity_data?.email ?? null,
        })),
        note: 'The API-based import recreates auth.users but does not fully recreate provider identities. Use a direct Postgres auth migration if you need exact social-login continuity.',
      });
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify({ temporaryPasswords: report, providerIdentities: identityReport }, null, 2) + '\n');
}

async function ensureBuckets(supabase, exportDir) {
  const storageRoot = path.join(exportDir, 'storage');
  if (!fs.existsSync(storageRoot)) return;
  const rootManifestPath = path.join(exportDir, 'manifest.json');
  const rootManifest = fs.existsSync(rootManifestPath)
    ? JSON.parse(fs.readFileSync(rootManifestPath, 'utf8'))
    : { buckets: [] };

  const entries = fs.readdirSync(storageRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const manifestPath = path.join(storageRoot, entry.name, 'manifest.json');
    const objects = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const bucketName = entry.name;
    const bucketConfig = rootManifest.buckets.find((bucket) => bucket.name === bucketName) || {};

    const createResult = await supabase.storage.createBucket(bucketName, {
      public: Boolean(bucketConfig.public),
      fileSizeLimit: bucketConfig.file_size_limit || undefined,
      allowedMimeTypes: bucketConfig.allowed_mime_types || undefined,
    });
    if (createResult.error && !/already exists/i.test(createResult.error.message)) {
      throw new Error(`bucket ${bucketName}: ${createResult.error.message}`);
    }

    for (const object of objects) {
      const localPath = path.join(storageRoot, bucketName, object.path);
      const fileBuffer = fs.readFileSync(localPath);
      const { error } = await supabase.storage.from(bucketName).upload(object.path, fileBuffer, {
        upsert: true,
        contentType: object.metadata?.mimetype || object.metadata?.contentType || 'application/octet-stream',
      });
      if (error) throw new Error(`${bucketName}/${object.path}: ${error.message}`);
    }
  }
}

async function main() {
  const exportDir = path.resolve(process.argv[2] || 'export/supabase-project');
  const envPath = path.resolve(process.argv[3] || 'deploy/supabase/.env');
  const env = loadEnv(envPath);
  if (!env.SUPABASE_PUBLIC_URL || !env.SERVICE_ROLE_KEY) {
    throw new Error(`Missing SUPABASE_PUBLIC_URL or SERVICE_ROLE_KEY in ${envPath}`);
  }

  const supabase = createClient(env.SUPABASE_PUBLIC_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const users = JSON.parse(fs.readFileSync(path.join(exportDir, 'auth-users.json'), 'utf8'));
  await ensureUsers(supabase, users, path.join(exportDir, 'import-auth-report.json'));

  for (const table of TABLES) {
    if (table === 'notifications') {
      await clearTable(supabase, 'notifications', 'id');
    }

    if (table === 'chat_threads') {
      // Projects and memberships can auto-create local chat rows via triggers.
      // Clear them immediately before importing the exported chat state.
      await clearTable(supabase, 'chat_messages', 'id');
      await clearTable(supabase, 'chat_thread_members', 'thread_id');
      await clearTable(supabase, 'chat_threads', 'id');
    }

    const tablePath = path.join(exportDir, 'tables', `${table}.json`);
    if (!fs.existsSync(tablePath)) continue;
    const rows = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    await upsertRows(supabase, table, rows);
  }

  await ensureBuckets(supabase, exportDir);
  console.log(`Import complete: ${exportDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
