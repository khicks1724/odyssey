import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export interface GitLabTokenConfigFields {
  token?: string;
  tokenEncrypted?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
}

function getGitLabTokenKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET;
  if (!secret) {
    throw new Error('AI_KEY_SECRET must be set to encrypt GitLab tokens');
  }
  return createHash('sha256').update(secret).digest();
}

export function getGitLabToken(config: GitLabTokenConfigFields | null | undefined): string {
  const encrypted = config?.tokenEncrypted?.trim();
  const iv = config?.tokenIv?.trim();
  const authTag = config?.tokenAuthTag?.trim();

  if (encrypted && iv && authTag) {
    const decipher = createDecipheriv('aes-256-gcm', getGitLabTokenKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8').trim();
  }

  return config?.token?.trim() ?? '';
}

export function storeGitLabToken<T extends Record<string, unknown>>(config: T, token: string): T {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getGitLabTokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token.trim(), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const nextConfig = {
    ...config,
    tokenEncrypted: encrypted.toString('base64'),
    tokenIv: iv.toString('base64'),
    tokenAuthTag: authTag.toString('base64'),
  } as T & GitLabTokenConfigFields;

  delete nextConfig.token;
  return nextConfig as T;
}
