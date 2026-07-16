/**
 * User GitHub PAT Management Routes
 *
 * Stores an encrypted personal GitHub token per user so the GitHub integration
 * panel can make authenticated API calls without hitting rate limits.
 *
 * Required DB migration (run once in Supabase SQL editor):
 *
 * CREATE TABLE user_github_tokens (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
 *   encrypted_key text NOT NULL,
 *   iv text NOT NULL,
 *   auth_tag text NOT NULL,
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now()
 * );
 * ALTER TABLE user_github_tokens ENABLE ROW LEVEL SECURITY;
 */

import type { FastifyInstance } from 'fastify';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { supabase } from '../lib/supabase.js';

function getEncryptionKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET;
  if (!secret) throw new Error('AI_KEY_SECRET must be set');
  return createHash('sha256').update(secret).digest();
}

function encrypt(plaintext: string): { encryptedKey: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptGitHubToken(encryptedKey: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export async function getStoredGitHubTokenForUser(userId: string | null | undefined): Promise<{
  token: string;
  updatedAt: string | null;
} | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from('user_github_tokens')
    .select('encrypted_key, iv, auth_tag, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;

  try {
    return {
      token: decryptGitHubToken(data.encrypted_key, data.iv, data.auth_tag),
      updatedAt: data.updated_at ?? data.created_at ?? null,
    };
  } catch {
    return null;
  }
}

async function getUserId(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  return error || !user ? null : user.id;
}

export async function userGitHubTokenRoutes(server: FastifyInstance) {
  // GET /api/user/github-token — returns { hasToken: bool, lastUpdated: string | null }
  server.get('/user/github-token', async (request, reply) => {
    const userId = await getUserId(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('user_github_tokens')
      .select('created_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) return reply.status(500).send({ error: 'DB error' });
    return {
      hasToken: !!data,
      lastUpdated: data?.updated_at ?? data?.created_at ?? null,
    };
  });

  // PUT /api/user/github-token — upsert encrypted token
  server.put<{ Body: { token: string } }>('/user/github-token', async (request, reply) => {
    const userId = await getUserId(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { token } = request.body ?? {};
    if (!token?.trim()) return reply.status(400).send({ error: 'token is required' });

    // Validate against GitHub API before storing
    const testRes = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Odyssey-App',
      },
    });
    if (!testRes.ok) {
      return reply.status(400).send({ error: 'GitHub token is invalid or does not have the required permissions.' });
    }

    const { encryptedKey, iv, authTag } = encrypt(token.trim());
    const { error } = await supabase
      .from('user_github_tokens')
      .upsert(
        { user_id: userId, encrypted_key: encryptedKey, iv, auth_tag: authTag, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );

    if (error) return reply.status(500).send({ error: 'Failed to save token' });
    return { ok: true };
  });

  // DELETE /api/user/github-token
  server.delete('/user/github-token', async (request, reply) => {
    const userId = await getUserId(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { error } = await supabase
      .from('user_github_tokens')
      .delete()
      .eq('user_id', userId);

    if (error) return reply.status(500).send({ error: 'Failed to delete token' });
    return { ok: true };
  });
}
