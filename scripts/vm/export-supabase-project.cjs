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

async function listUsers(supabase) {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (!data.nextPage) break;
    page = data.nextPage;
  }
  return users;
}

async function fetchTableRows(supabase, table) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + pageSize - 1);
    if (error) {
      if (
        /relation .* does not exist/i.test(error.message) ||
        /could not find the table .* in the schema cache/i.test(error.message)
      ) {
        return null;
      }
      throw new Error(`${table}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function walkBucket(storage, bucket, prefix = '') {
  const objects = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`${bucket}:${prefix || '/'}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        objects.push(...await walkBucket(storage, bucket, entryPath));
      } else {
        objects.push({ path: entryPath, metadata: entry.metadata ?? null });
      }
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return objects;
}

async function main() {
  const outputDir = path.resolve(process.argv[2] || 'export/supabase-project');
  const envPath = path.resolve(process.argv[3] || 'server/.env');
  const env = loadEnv(envPath);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error(`Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in ${envPath}`);
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'tables'), { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'storage'), { recursive: true });

  const manifest = {
    exportedAt: new Date().toISOString(),
    sourceUrl: env.SUPABASE_URL,
    tables: {},
    buckets: [],
    userCount: 0,
  };

  const users = await listUsers(supabase);
  manifest.userCount = users.length;
  fs.writeFileSync(path.join(outputDir, 'auth-users.json'), JSON.stringify(users, null, 2) + '\n');

  for (const table of TABLES) {
    const rows = await fetchTableRows(supabase, table);
    if (rows === null) continue;
    manifest.tables[table] = rows.length;
    fs.writeFileSync(path.join(outputDir, 'tables', `${table}.json`), JSON.stringify(rows, null, 2) + '\n');
  }

  const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
  if (bucketsError) throw bucketsError;

  for (const bucket of buckets) {
    const bucketDir = path.join(outputDir, 'storage', bucket.name);
    fs.mkdirSync(bucketDir, { recursive: true });
    const objects = await walkBucket(supabase.storage, bucket.name);
    manifest.buckets.push({
      id: bucket.id,
      name: bucket.name,
      public: bucket.public,
      file_size_limit: bucket.file_size_limit ?? null,
      allowed_mime_types: bucket.allowed_mime_types ?? null,
      objectCount: objects.length,
    });
    fs.writeFileSync(path.join(bucketDir, 'manifest.json'), JSON.stringify(objects, null, 2) + '\n');

    for (const object of objects) {
      const { data, error } = await supabase.storage.from(bucket.name).download(object.path);
      if (error) throw new Error(`${bucket.name}/${object.path}: ${error.message}`);
      const fileBuffer = Buffer.from(await data.arrayBuffer());
      const digest = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const localPath = path.join(bucketDir, object.path);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, fileBuffer);
      object.sha256 = digest;
      object.size = fileBuffer.length;
    }

    fs.writeFileSync(path.join(bucketDir, 'manifest.json'), JSON.stringify(objects, null, 2) + '\n');
  }

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Export complete: ${outputDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
