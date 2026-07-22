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
 *   config jsonb NOT NULL DEFAULT '{}'::jsonb,
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
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { clearProviderError } from '../ai-providers.js';
import { supabase } from '../lib/supabase.js';
import {
  GenAiMilApiError,
  createGenAiMilChatCompletion,
  isGenAiMilKey,
  listGenAiMilModels,
} from '../lib/genai-mil.js';

type Provider = 'anthropic' | 'openai' | 'google' | 'google_ai' | 'nvidia' | 'gemma4';
const VALID_PROVIDERS: Provider[] = ['anthropic', 'openai', 'google', 'google_ai', 'nvidia', 'gemma4'];
type OpenAiCredentialMode = 'openai' | 'azure_openai';
type ProviderCredentialConfig = {
  mode?: OpenAiCredentialMode;
  endpoint?: string;
  preferredModel?: string;
  enabledModels?: string[];
  availableModels?: string[];
};

type CredentialTestResult = {
  message: string;
  model?: string;
  models?: string[];
};

type StoredKeyRow = {
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  config?: unknown;
  credential_type?: 'api_key' | 'oauth';
};

const TEST_OUTPUT_TOKENS = 16;
const DEFAULT_NVIDIA_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_GEMMA4_MODEL = 'google/gemma-4-31b-it';

// ── Encryption helpers ─────────────────────────────────────────────────────

function getEncryptionKey(): Buffer {
  const secret = process.env.AI_KEY_SECRET;
  if (!secret) {
    throw new Error('AI_KEY_SECRET must be set to encrypt provider credentials');
  }
  return createHash('sha256').update(secret).digest();
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

function normalizeOpenAiEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const openAiV1Index = url.pathname.toLowerCase().indexOf('/openai/v1');
    if (openAiV1Index >= 0) {
      url.pathname = url.pathname.slice(0, openAiV1Index + '/openai/v1'.length);
    } else if (/\.openai\.azure\.com$/i.test(url.hostname)) {
      url.pathname = '/openai/v1';
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return trimmed
      .replace(/[?#].*$/, '')
      .replace(/\/(?:chat\/completions|responses|models)\/?$/i, '')
      .replace(/\/+$/, '');
  }
}

function normalizePreferredOpenAiModel(model: string): string {
  return model.trim();
}

function getModelCapabilityScore(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();
  let score = 0;

  if (normalized.includes('claude-opus')) score = 1000;
  else if (normalized.startsWith('gpt-5')) score = 900;
  else if (normalized.startsWith('o4')) score = 850;
  else if (normalized.includes('claude-sonnet')) score = 800;
  else if (normalized.startsWith('o3')) score = 780;
  else if (normalized.startsWith('codex')) score = 760;
  else if (normalized.startsWith('o1')) score = 740;
  else if (normalized.startsWith('gpt-4.1')) score = 700;
  else if (normalized.startsWith('gpt-4o')) score = 650;
  else if (normalized.includes('gemini')) score = 600;
  else if (normalized.includes('claude-haiku')) score = 500;
  else if (normalized.includes('genai-mil')) score = 450;
  else if (normalized.startsWith('gpt-4')) score = 400;
  else if (normalized.startsWith('gpt-3.5')) score = 300;

  if (/(^|[-_.])nano($|[-_.])/.test(normalized)) score -= 40;
  if (/(^|[-_.])mini($|[-_.])/.test(normalized)) score -= 25;
  if (/(^|[-_.])flash($|[-_.])/.test(normalized)) score -= 20;

  const datedVersion = normalized.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (datedVersion) {
    score += Number(`${datedVersion[1]}${datedVersion[2]}${datedVersion[3]}`) / 100000000;
  }

  return score;
}

function pickMostCapableModelId(modelIds: string[]): string {
  const uniqueIds = [...new Set(modelIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) return '';

  return [...uniqueIds].sort((a, b) => {
    const diff = getModelCapabilityScore(b) - getModelCapabilityScore(a);
    return diff !== 0 ? diff : a.localeCompare(b);
  })[0];
}

function normalizeEnabledModels(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeGenAiMilModels(values: unknown): string[] {
  return normalizeEnabledModels(values)
    .map((model) => model.startsWith('genai-mil:') ? model.slice('genai-mil:'.length).trim() : model)
    .filter((model) => model && model !== 'genai-mil');
}

function normalizeNvidiaApiKeys(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function parseStoredNvidiaApiKeys(plaintext: string): string[] {
  const trimmed = plaintext.trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return [trimmed];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return normalizeNvidiaApiKeys(parsed);
    if (parsed && typeof parsed === 'object' && 'keys' in parsed) {
      return normalizeNvidiaApiKeys((parsed as { keys?: unknown }).keys);
    }
  } catch {
    return [trimmed];
  }
  return [];
}

function sanitizeConfig(provider: Provider, raw: unknown): ProviderCredentialConfig {
  if (provider === 'nvidia' || provider === 'gemma4') {
    if (!raw || typeof raw !== 'object') {
      return {
        preferredModel: provider === 'gemma4' ? DEFAULT_GEMMA4_MODEL : DEFAULT_NVIDIA_MODEL,
        enabledModels: [provider],
      };
    }
    const preferredModel = typeof (raw as { preferredModel?: unknown }).preferredModel === 'string'
      ? normalizePreferredOpenAiModel((raw as { preferredModel: string }).preferredModel)
      : provider === 'gemma4' ? DEFAULT_GEMMA4_MODEL : DEFAULT_NVIDIA_MODEL;
    const enabledModels = normalizeEnabledModels((raw as { enabledModels?: unknown }).enabledModels);
    return {
      preferredModel: preferredModel || (provider === 'gemma4' ? DEFAULT_GEMMA4_MODEL : DEFAULT_NVIDIA_MODEL),
      enabledModels: enabledModels.length > 0 ? enabledModels : [provider],
    };
  }

  if (provider === 'google' && raw && typeof raw === 'object') {
    const preferredModel = normalizeGenAiMilModels(
      typeof (raw as { preferredModel?: unknown }).preferredModel === 'string'
        ? [(raw as { preferredModel: string }).preferredModel]
        : [],
    )[0];
    const enabledModels = normalizeGenAiMilModels((raw as { enabledModels?: unknown }).enabledModels);
    const availableModels = normalizeGenAiMilModels((raw as { availableModels?: unknown }).availableModels);
    return {
      ...(preferredModel ? { preferredModel } : {}),
      ...(enabledModels.length ? { enabledModels } : {}),
      ...(availableModels.length ? { availableModels } : {}),
    };
  }

  if (provider !== 'openai' || !raw || typeof raw !== 'object') {
    if (provider === 'openai') return { mode: 'openai' };
    return raw && typeof raw === 'object'
      ? { enabledModels: normalizeEnabledModels((raw as { enabledModels?: unknown }).enabledModels) }
      : {};
  }

  const candidate = raw as { mode?: unknown; endpoint?: unknown; enabledModels?: unknown };
  const mode: OpenAiCredentialMode = candidate.mode === 'azure_openai' ? 'azure_openai' : 'openai';
  const endpoint = typeof candidate.endpoint === 'string' ? normalizeOpenAiEndpoint(candidate.endpoint) : undefined;
  const preferredModel = typeof (raw as { preferredModel?: unknown }).preferredModel === 'string'
    ? normalizePreferredOpenAiModel((raw as { preferredModel: string }).preferredModel)
    : undefined;
  const enabledModels = normalizeEnabledModels(candidate.enabledModels);

  if (mode === 'azure_openai') {
    return {
      mode,
      ...(endpoint ? { endpoint } : {}),
      ...(preferredModel ? { preferredModel } : {}),
      ...(enabledModels.length ? { enabledModels } : {}),
    };
  }

  return {
    mode: 'openai',
    ...(preferredModel ? { preferredModel } : {}),
    ...(enabledModels.length ? { enabledModels } : {}),
  };
}

function validateConfig(provider: Provider, raw: unknown): { config: ProviderCredentialConfig; error?: string } {
  const config = sanitizeConfig(provider, raw);
  if (provider === 'nvidia' || provider === 'gemma4') {
    if (!config.preferredModel?.trim()) {
      return { config, error: provider === 'gemma4' ? 'A default Gemma 4 model ID is required.' : 'A default NVIDIA model ID is required.' };
    }
    return { config };
  }
  if (provider !== 'openai') return { config };

  if (config.mode === 'azure_openai') {
    if (!config.endpoint) {
      return { config, error: 'Azure OpenAI endpoint is required when Azure mode is enabled' };
    }
    if (!/^https:\/\//i.test(config.endpoint)) {
      return { config, error: 'Azure OpenAI endpoint must start with https://' };
    }
    if (!/\/openai\/v1$/i.test(config.endpoint)) {
      return { config, error: 'Azure OpenAI endpoint must end with /openai/v1' };
    }
  }

  return { config };
}

function parseGoogleOAuthCredential(value: string): { access_token: string } | null {
  if (!value.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(value) as { access_token?: unknown };
    return typeof parsed.access_token === 'string' && parsed.access_token
      ? { access_token: parsed.access_token }
      : null;
  } catch {
    return null;
  }
}

function shouldRetryWithMaxCompletionTokens(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unsupported parameter:\s*['"]max_tokens['"]/i.test(message)
    || (/max_tokens/i.test(message) && /max_completion_tokens/i.test(message));
}

async function testAnthropicCredential(apiKey: string): Promise<{ message: string; model?: string }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: TEST_OUTPUT_TOKENS,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Anthropic API ${response.status}`);
  }

  return { message: 'Anthropic key is valid.', model: 'claude-haiku-4-5-20251001' };
}

function getAzureDeploymentCandidates(modelIds: string[]): string[] {
  const gpt56Model = /^gpt-5\.6-(terra|luna|sol)(?:-\d{4}-\d{2}-\d{2})?$/i;

  return [...new Set(
    modelIds
      .map((modelId) => modelId.trim())
      .filter((modelId) => gpt56Model.test(modelId))
      .map((modelId) => modelId.replace(/-\d{4}-\d{2}-\d{2}$/i, ''))
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b));
}

async function testAzureDeployment(client: OpenAI, deployment: string): Promise<void> {
  try {
    await client.chat.completions.create({
      model: deployment,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: TEST_OUTPUT_TOKENS,
    });
  } catch (error: unknown) {
    if (!shouldRetryWithMaxCompletionTokens(error)) throw error;
    await client.chat.completions.create({
      model: deployment,
      messages: [{ role: 'user', content: 'ping' }],
      max_completion_tokens: TEST_OUTPUT_TOKENS,
    });
  }
}

async function discoverAzureDeployments(client: OpenAI, requestedDeployments: string[] = []): Promise<string[]> {
  const models = await client.models.list();
  const candidates = [...new Set([
    ...requestedDeployments.map((deployment) => deployment.trim()).filter(Boolean),
    ...getAzureDeploymentCandidates(models.data.map((entry) => entry.id)),
  ])];
  const available: string[] = [];
  const batchSize = 5;

  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const results = await Promise.all(batch.map(async (deployment) => {
      try {
        await testAzureDeployment(client, deployment);
        return deployment;
      } catch {
        return null;
      }
    }));
    available.push(...results.filter((deployment): deployment is string => !!deployment));
  }

  return available;
}

async function testOpenAiCredential(apiKey: string, config: ProviderCredentialConfig): Promise<CredentialTestResult> {
  const useAzure = config.mode === 'azure_openai' && !!config.endpoint;
  const client = new OpenAI({
    apiKey,
    ...(useAzure ? { baseURL: config.endpoint } : {}),
    ...(useAzure ? { defaultHeaders: { 'api-key': apiKey } } : {}),
    timeout: 20000,
  });

  if (useAzure) {
    const requestedDeployments = normalizeEnabledModels([
      ...(config.enabledModels ?? []),
      ...(config.preferredModel ? [config.preferredModel] : []),
    ]);
    const deployments = await discoverAzureDeployments(client, requestedDeployments);
    if (deployments.length === 0) {
      throw new Error('Azure credentials are valid, but no callable chat deployments were discovered. Create a deployment in Azure or enter its exact deployment ID.');
    }
    return {
      message: `Azure OpenAI is valid. Discovered ${deployments.length} callable deployment${deployments.length === 1 ? '' : 's'}.`,
      model: deployments[0],
      models: deployments,
    };
  }

  const models = await client.models.list();
  const modelIds = models.data.map((entry) => entry.id);
  const model = config.preferredModel?.trim() || pickMostCapableModelId(modelIds) || models.data[0]?.id;
  return {
    message: 'OpenAI key is valid.',
    model,
  };
}

async function testNvidiaCredential(apiKeys: string[], config: ProviderCredentialConfig): Promise<{ message: string; model?: string }> {
  const model = config.preferredModel?.trim() || DEFAULT_NVIDIA_MODEL;
  let lastError: unknown = null;

  for (const apiKey of apiKeys) {
    const client = new OpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey,
    });

    try {
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: TEST_OUTPUT_TOKENS,
        temperature: 1,
        top_p: 0.95,
        extra_body: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_budget: TEST_OUTPUT_TOKENS,
        },
      } as Parameters<typeof client.chat.completions.create>[0]);

      return { message: 'NVIDIA API key set is valid.', model };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('NVIDIA credential test failed.');
}

async function testGemma4Credential(apiKeys: string[], config: ProviderCredentialConfig): Promise<{ message: string; model?: string }> {
  const model = config.preferredModel?.trim() || DEFAULT_GEMMA4_MODEL;
  let lastError: unknown = null;

  for (const apiKey of apiKeys) {
    const client = new OpenAI({
      baseURL: 'https://integrate.api.nvidia.com/v1',
      apiKey,
    });

    try {
      await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: TEST_OUTPUT_TOKENS,
        temperature: 1,
        top_p: 0.95,
        extra_body: {
          chat_template_kwargs: { enable_thinking: true },
          reasoning_budget: TEST_OUTPUT_TOKENS,
        },
      } as Parameters<typeof client.chat.completions.create>[0]);

      return { message: 'Gemma 4 API key set is valid.', model };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Gemma 4 credential test failed.');
}

async function testGeminiBearer(accessToken: string): Promise<{ message: string; model?: string }> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Google AI API ${response.status}`);
  }

  return { message: 'Google account credential is valid.', model: 'gemini-2.0-flash' };
}

async function testGoogleCredential(provider: Provider, credential: string, config: ProviderCredentialConfig = {}): Promise<CredentialTestResult> {
  const oauth = parseGoogleOAuthCredential(credential);
  if (oauth) {
    return testGeminiBearer(oauth.access_token);
  }

  if (provider === 'google' && isGenAiMilKey(credential)) {
    // STARK documents model discovery as the credential/scope check. Do not pick
    // an arbitrary completion model: only verify one explicitly configured by the user.
    const models = await listGenAiMilModels(credential);
    const configuredModel = config.preferredModel?.trim() || process.env.GENAI_MIL_MODEL?.trim();
    if (configuredModel && !models.includes(configuredModel)) {
      throw new GenAiMilApiError({
        code: 'model_not_found',
        message: `The selected GenAI.mil model is no longer available: ${configuredModel}`,
      });
    }
    if (configuredModel) {
      await createGenAiMilChatCompletion({
        apiKey: credential,
        model: configuredModel,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxTokens: TEST_OUTPUT_TOKENS,
        temperature: 0,
        timeoutMs: 30_000,
      });
    }
    clearProviderError('genai-mil', credential);
    return {
      message: `GenAI.mil key is valid (${models.length} model${models.length === 1 ? '' : 's'} available).`,
      ...(configuredModel ? { model: configuredModel } : {}),
      models,
    };
  }

  const client = new GoogleGenerativeAI(credential);
  const model = 'gemini-2.0-flash';
  const result = await client.getGenerativeModel({ model }).generateContent('ping');
  const text = result.response.text();
  if (typeof text !== 'string') {
    throw new Error('Google AI credential test did not return a response.');
  }
  return {
    message: provider === 'google_ai' ? 'Google AI Studio key is valid.' : 'Google credential is valid.',
    model,
  };
}

async function testStoredCredential(provider: Provider, row: StoredKeyRow): Promise<CredentialTestResult> {
  const plaintext = decryptUserKey(row.encrypted_key, row.iv, row.auth_tag);
  const config = sanitizeConfig(provider, row.config);

  if (provider === 'anthropic') {
    return testAnthropicCredential(plaintext);
  }
  if (provider === 'openai') {
    return testOpenAiCredential(plaintext, config);
  }
  if (provider === 'nvidia') {
    return testNvidiaCredential(parseStoredNvidiaApiKeys(plaintext), config);
  }
  if (provider === 'gemma4') {
    return testGemma4Credential(parseStoredNvidiaApiKeys(plaintext), config);
  }
  return testGoogleCredential(provider, plaintext);
}

async function testPlaintextCredential(provider: Provider, apiKey: string, config: ProviderCredentialConfig): Promise<CredentialTestResult> {
  if (provider === 'anthropic') {
    return testAnthropicCredential(apiKey);
  }
  if (provider === 'openai') {
    return testOpenAiCredential(apiKey, config);
  }
  if (provider === 'nvidia') {
    return testNvidiaCredential(normalizeNvidiaApiKeys([apiKey]), config);
  }
  if (provider === 'gemma4') {
    return testGemma4Credential(normalizeNvidiaApiKeys([apiKey]), config);
  }
  return testGoogleCredential(provider, apiKey, config);
}

// ── Route plugin ───────────────────────────────────────────────────────────

export async function userAiKeysRoutes(server: FastifyInstance) {
  // GET /api/user/ai-keys — returns which providers are configured (no actual keys)
  server.get('/user/ai-keys', async (request, reply) => {
    const userId = await getUserFromRequest(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { data, error } = await supabase
      .from('user_ai_keys')
      .select('provider, updated_at, credential_type, config')
      .eq('user_id', userId);

    if (error) {
      server.log.error(error);
      return reply.status(500).send({ error: 'Failed to fetch AI keys' });
    }

    // Return status for all providers (whether configured or not)
    const configuredMap = new Map(
      (data ?? []).map((row: { provider: string; updated_at: string; credential_type: string; config?: unknown }) => [
        row.provider,
        {
          updated_at: row.updated_at,
          credential_type: row.credential_type,
          config: sanitizeConfig(row.provider as Provider, row.config),
        },
      ]),
    );

    const result = VALID_PROVIDERS.map((provider) => ({
      provider,
      hasKey: configuredMap.has(provider),
      lastUpdated: configuredMap.get(provider)?.updated_at ?? null,
      credentialType: (configuredMap.get(provider)?.credential_type ?? 'api_key') as 'api_key' | 'oauth',
      config: configuredMap.get(provider)?.config ?? sanitizeConfig(provider, undefined),
    }));

    return result;
  });

  // PUT /api/user/ai-keys — store/update a provider API key or OAuth credential (encrypted)
  server.put<{ Body: { provider: Provider; apiKey?: string; apiKeys?: string[]; credentialType?: 'api_key' | 'oauth'; config?: ProviderCredentialConfig } }>(
    '/user/ai-keys',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider, apiKey, apiKeys, credentialType = 'api_key', config: rawConfig } = request.body ?? {};

      if (!provider || !VALID_PROVIDERS.includes(provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }
      const normalizedApiKeys = provider === 'nvidia' || provider === 'gemma4'
        ? normalizeNvidiaApiKeys(apiKeys ?? (typeof apiKey === 'string' ? [apiKey] : []))
        : [];

      if (provider === 'nvidia' || provider === 'gemma4') {
        if (normalizedApiKeys.length === 0) {
          return reply.status(400).send({ error: provider === 'gemma4' ? 'At least one Gemma 4 API key is required' : 'At least one NVIDIA API key is required' });
        }
      } else if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return reply.status(400).send({ error: 'apiKey must be a non-empty string' });
      }

      const { config: validatedConfig, error: configError } = validateConfig(provider, rawConfig);
      if (configError) {
        return reply.status(400).send({ error: configError });
      }

      let config = validatedConfig;
      if (provider === 'openai' && config.mode === 'azure_openai' && config.endpoint) {
        try {
          const azureClient = new OpenAI({
            apiKey: apiKey!.trim(),
            baseURL: config.endpoint,
            defaultHeaders: { 'api-key': apiKey!.trim() },
            timeout: 20000,
          });
          const requestedDeployments = normalizeEnabledModels([
            ...(config.enabledModels ?? []),
            ...(config.preferredModel ? [config.preferredModel] : []),
          ]);
          const deployments = await discoverAzureDeployments(azureClient, requestedDeployments);
          if (deployments.length === 0) {
            return reply.status(400).send({ error: 'Azure credentials are valid, but no callable chat deployments were discovered.' });
          }
          config = {
            ...config,
            preferredModel: deployments[0],
            enabledModels: deployments,
          };
        } catch (error: unknown) {
          return reply.status(400).send({ error: error instanceof Error ? error.message : 'Failed to discover Azure deployments' });
        }
      }

      const plaintextToStore = provider === 'nvidia' || provider === 'gemma4'
        ? JSON.stringify(normalizedApiKeys)
        : apiKey!.trim();
      const { encryptedKey, iv, authTag } = encryptKey(plaintextToStore);

      const { error } = await supabase
        .from('user_ai_keys')
        .upsert(
          {
            user_id: userId,
            provider,
            config,
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

      return { success: true, provider, credentialType, config };
    },
  );

  server.patch<{ Params: { provider: string }; Body: { config?: ProviderCredentialConfig } }>(
    '/user/ai-keys/:provider/config',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider } = request.params;
      if (!VALID_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }

      const { config: rawConfig } = request.body ?? {};
      const { config, error: configError } = validateConfig(provider as Provider, rawConfig);
      if (configError) {
        return reply.status(400).send({ error: configError });
      }

      const { error } = await supabase
        .from('user_ai_keys')
        .update({
          config,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', provider);

      if (error) {
        server.log.error(error);
        return reply.status(500).send({ error: 'Failed to update provider settings' });
      }

      return { success: true, provider, config };
    },
  );

  function maskStoredKey(): string {
    return '••••••••••••••••';
  }

  // GET /api/user/ai-keys/:provider/reveal — returns a mask only; plaintext keys are never revealed to the browser
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
        .select('encrypted_key, iv, auth_tag, config')
        .eq('user_id', userId)
        .eq('provider', provider)
        .single();

      if (error || !data) return reply.status(404).send({ error: 'No key stored for this provider' });

      return {
        key: maskStoredKey(),
        masked: true,
        config: sanitizeConfig(provider as Provider, data.config),
      };
    },
  );

  server.post<{ Params: { provider: string }; Body: { apiKey?: string; apiKeys?: string[]; config?: ProviderCredentialConfig } }>(
    '/user/ai-keys/:provider/test',
    async (request, reply) => {
      const userId = await getUserFromRequest(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const { provider } = request.params;
      if (!VALID_PROVIDERS.includes(provider as Provider)) {
        return reply.status(400).send({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
      }

      const { apiKey, apiKeys, config: rawConfig } = request.body ?? {};
      const { config, error: configError } = validateConfig(provider as Provider, rawConfig);
      if (configError) {
        return reply.status(400).send({ error: configError });
      }

      try {
        const normalizedApiKeys = provider === 'nvidia' || provider === 'gemma4'
          ? normalizeNvidiaApiKeys(apiKeys ?? (typeof apiKey === 'string' ? [apiKey] : []))
          : [];

        if (provider === 'nvidia' && normalizedApiKeys.length > 0) {
          const result = await testNvidiaCredential(normalizedApiKeys, config);
          return { ok: true, provider, ...result };
        }

        if (provider === 'gemma4' && normalizedApiKeys.length > 0) {
          const result = await testGemma4Credential(normalizedApiKeys, config);
          return { ok: true, provider, ...result };
        }

        if (typeof apiKey === 'string' && apiKey.trim().length > 0) {
          const result = await testPlaintextCredential(provider as Provider, apiKey.trim(), config);
          return { ok: true, provider, ...result };
        }

        const { data, error } = await supabase
          .from('user_ai_keys')
          .select('encrypted_key, iv, auth_tag, config, credential_type')
          .eq('user_id', userId)
          .eq('provider', provider)
          .single();

        if (error || !data) {
          return reply.status(404).send({ error: 'No key stored for this provider' });
        }

        const storedWithOverride: StoredKeyRow = {
          ...(data as StoredKeyRow),
          config: rawConfig ?? data.config,
        };
        const result = await testStoredCredential(provider as Provider, storedWithOverride);
        return { ok: true, provider, ...result };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Credential test failed';
        if (err instanceof GenAiMilApiError) {
          const status = err.status >= 400 && err.status <= 599
            ? err.status
            : err.code === 'invalid_response'
              ? 502
              : 503;
          return reply.status(status).send({
            error: message,
            errorCode: err.code,
            ...(err.unlockUrl ? { unlockUrl: err.unlockUrl } : {}),
            ...(err.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: err.retryAfterSeconds }),
          });
        }
        return reply.status(400).send({ error: message });
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
