/**
 * User AI API Key Management Routes
 *
 * Allows users to store their own provider API keys encrypted in the database.
 * These keys override the server's environment variables when that user makes AI requests.
 *
 * Required DB migration (run once in Supabase SQL editor):
 *
 * CREATE TABLE user_ai_keys (
 *   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
 *   user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 *   provider text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google')),
 *   encrypted_key text NOT NULL,
 *   iv text NOT NULL,
 *   auth_tag text NOT NULL,
 *   created_at timestamptz DEFAULT now(),
 *   updated_at timestamptz DEFAULT now(),
 *   UNIQUE(user_id, provider)
 * );
 *
 * -- Enable RLS (server uses service role key so it bypasses RLS, but good practice)
 * ALTER TABLE user_ai_keys ENABLE ROW LEVEL SECURITY;
 */

import type { FastifyInstance } from 'fastify';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { supabase } from '../lib/supabase.js';

type Provider = 'anthropic' | 'openai' | 'google' | 'google_ai';
const VALID_PROVIDERS: Provider[] = ['anthropic', 'openai', 'google', 'google_ai'];

// ── Encryption helpers ─────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET;
  if (secret) {
    // Derive a 32-byte key from the secret
    return createHash('sha256').update(secret).digest();
  }
  // Fall back to a hash of the Supabase service role key
  const fallback = process.env.SUPABASE_SERVICE_KEY ?? 'odyssey-fallback-key';
  return createHash('sha256').update(fallback).digest();
}

function encryptKey(plaintext: string): { encryptedKey: string; iv: string; authTag: string } {
  const key = getEncryptionKey();
  const iv = randomBytes(12); // 96-bit IV for GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decryptUserKey(encryptedKey: string, iv: string, authTag: string): string {
  const key = getEncryptionKey();
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedKey, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ── Auth helper ────────────────────────────────────────────────────────────

async function getUserFromRequest(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

// ── Route plugin ───────────────────────────────────────────────────────────

export async function userAiKeysRoutes(server: FastifyInstance) {
  // GET /api/user/ai-keys — returns which providers are configured (no actual keys)
  server.get('/user/ai-keys', async (request, reply) => {
    const userId = await getUserFromRequest(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('user_ai_keys')
      .select('provider, updated_at, credential_type')
      .eq('user_id', userId);

    if (error) {
      server.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch AI keys' });
    }

    // Return status for all providers (whether configured or not)
    const configuredMap = new Map(
      (data ?? []).map((row: { provider: string; updated_at: string; credential_type: string }) => [
        row.provider,
        { updated_at: row.updated_at, credential_type: row.credential_type },
      ]),
    );

    const result = VALID_PROVIDERS.map((provider) => ({
      provider,
      hasKey: configuredMap.has(provider),
      lastUpdated: configuredMap.get(provider)?.updated_at ?? null,
      credentialType: (configuredMap.get(provider)?.credential_type ?? 'api_key') as 'api_key' | 'oauth',
    }));

    return result;
  });

  // PUT /api/user/ai-keys — store/update a provider API key or OAuth credential (encrypted)
  server.put<{ Body: { provider: Provider; apiKey: string; credentialType?: 'api_key' | 'oauth' } }>(
    '/user/ai-keys',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider, apiKey, credentialType = 'api_key' } = request.body ?? {};

      if (!provider || !VALID_PROVIDERS.includes(provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }
      if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return reply.status(400).send({ error: 'apiKey must be a non-empty string' });
      }

      const { encryptedKey, iv, authTag } = encryptKey(apiKey.trim());

      const { error } = await supabase
        .from('user_ai_keys')
        .upsert(
          {
            user_id: userId,
            provider,
            encrypted_key: encryptedKey,
            iv,
            auth_tag: authTag,
            credential_type: credentialType,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,provider' },
        );

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to save API key' });
      }

      return { success: true, provider, credentialType };
    },
  );

  // GET /api/user/ai-keys/:provider/reveal — return the decrypted key for display
  server.get<{ Params: { provider: string } }>(
    '/user/ai-keys/:provider/reveal',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider } = request.params;
      if (!VALID_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }

      const { data, error } = await supabase
        .from('user_ai_keys')
        .select('encrypted_key, iv, auth_tag')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();

      if (error || !data) return reply.status(404).send({ error: 'No key stored for this provider' });

      try {
        const plaintext = decryptUserKey(data.encrypted_key, data.iv, data.auth_tag);
        return { key: plaintext };
      } catch {
        return reply.status(500).send({ error: 'Failed to decrypt key' });
      }
    },
  );

  // DELETE /api/user/ai-keys/:provider — remove a user's key for a provider
  server.delete<{ Params: { provider: string } }>(
    '/user/ai-keys/:provider',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider } = request.params;

      if (!VALID_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }

      const { error } = await supabase
        .from('user_ai_keys')
        .delete()
        .eq('user_id', userId)
        .eq('provider', provider);

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to remove API key' });
      }

      return { success: true, provider };
    },
  );
}
