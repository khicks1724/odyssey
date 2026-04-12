import type { FastifyInstance } from 'fastify';
import { isRateLimited, resetInSeconds } from '../lib/rate-limit.js';
import { supabase } from '../lib/supabase.js';
import {
  createDefaultThesisDocumentSeed,
  isKyleHicksDisplayName,
} from '../lib/thesis-default.js';
import {
  normalizeUsername,
  usernameToInternalEmail,
  validatePassword,
  validateUsername,
} from '../lib/username-auth.js';

type RegisterBody = {
  username?: string;
  password?: string;
  displayName?: string;
};

const USER_EXISTS_PATTERN = /already exists|already been registered|already registered/i;
const MISSING_USERNAME_COLUMN_PATTERN = /column .*username.* does not exist|could not find the 'username' column .* schema cache/i;

function getClientKey(ip: string, action: string, username?: string): string {
  const normalized = username ? normalizeUsername(username) : 'unknown';
  return `${action}:${ip}:${normalized}`;
}

function sanitizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 80) : fallback;
}

function isMissingUsernameColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return error?.code === '42703' || MISSING_USERNAME_COLUMN_PATTERN.test(error?.message ?? '');
}

async function authUserExistsByUsername(username: string): Promise<boolean> {
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;

    const users = data.users ?? [];
    if (users.some((user) => (user.user_metadata?.username ?? '').toLowerCase() === username)) {
      return true;
    }

    if (users.length < 1000) return false;
    page += 1;
  }
}

export async function authRoutes(server: FastifyInstance) {
  server.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
    const { username = '', password = '', displayName } = request.body ?? {};
    const rateLimitKey = getClientKey(request.ip, 'auth-register', username);

    if (isRateLimited(rateLimitKey)) {
      return reply.status(429).send({
        error: 'Too many signup attempts. Please wait before trying again.',
        retryAfterSeconds: resetInSeconds(rateLimitKey),
      });
    }

    const usernameError = validateUsername(username);
    if (usernameError) return reply.status(400).send({ error: usernameError });

    const passwordError = validatePassword(password);
    if (passwordError) return reply.status(400).send({ error: passwordError });

    const normalizedUsername = normalizeUsername(username);
    const internalEmail = usernameToInternalEmail(normalizedUsername);
    const safeDisplayName = sanitizeDisplayName(displayName, normalizedUsername);

    const { data: existingProfile, error: existingProfileError } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', normalizedUsername)
      .maybeSingle();

    if (existingProfileError && !isMissingUsernameColumn(existingProfileError)) {
      request.log.error(existingProfileError);
      return reply.status(500).send({ error: 'Unable to create account right now' });
    }

    const usernameAlreadyExists = existingProfile
      ? true
      : existingProfileError
        ? await authUserExistsByUsername(normalizedUsername)
        : false;

    if (usernameAlreadyExists) {
      return reply.status(409).send({ error: 'That username is already taken' });
    }

    const { data: createdUser, error: createUserError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username: normalizedUsername,
        user_name: normalizedUsername,
        name: safeDisplayName,
        display_name: safeDisplayName,
      },
    });

    if (createUserError) {
      if (USER_EXISTS_PATTERN.test(createUserError.message)) {
        return reply.status(409).send({ error: 'That username is already taken' });
      }

      request.log.error(createUserError);
      return reply.status(500).send({ error: 'Unable to create account right now' });
    }

    const userId = createdUser.user?.id;
    if (!userId) {
      request.log.error({ username: normalizedUsername }, 'Supabase user was created without an id');
      return reply.status(500).send({ error: 'Unable to create account right now' });
    }

    const baseProfile = {
      id: userId,
      display_name: safeDisplayName,
      email: internalEmail,
    };

    let { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        ...baseProfile,
        username: normalizedUsername,
      });

    if (isMissingUsernameColumn(profileError)) {
      ({ error: profileError } = await supabase
        .from('profiles')
        .upsert(baseProfile));
    }

    if (profileError) {
      request.log.error(profileError);
      await supabase.auth.admin.deleteUser(userId).catch(() => undefined);
      return reply.status(500).send({ error: 'Unable to finish account setup right now' });
    }

    if (!isKyleHicksDisplayName(safeDisplayName)) {
      const seed = createDefaultThesisDocumentSeed();
      const { error: thesisDocumentError } = await supabase
        .from('thesis_documents')
        .upsert({
          user_id: userId,
          draft: seed.draft,
          editor_theme: null,
          snapshot: seed.snapshot,
          repo_sync_status: 'idle',
          repo_sync_error: null,
          repo_synced_at: null,
        });

      if (thesisDocumentError) {
        request.log.error({
          error: thesisDocumentError,
          userId,
          username: normalizedUsername,
        }, 'failed to seed default thesis document during registration');
      }
    }

    return reply.status(201).send({
      success: true,
      username: normalizedUsername,
    });
  });
}
