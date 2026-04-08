import type { FastifyInstance, FastifyReply } from 'fastify';
import OpenAI from 'openai';
import { chat, streamChat, getAvailableProviders, getCachedProviderStatus, getServerOpenAiCredential, getServerOpenAiPrimaryModel, isGenAiMilKey, type AIProvider, type AIProviderSelection, type OpenAiProviderSelection, type ProviderCredentialOverride } from '../ai-providers.js';
import { supabase } from '../lib/supabase.js';
import { canonicalizeOpenAiModelId, normalizeOpenAiModelIds } from '../lib/openai-models.js';
import { decryptUserKey } from './user-ai-keys.js';
import { isRateLimited, resetInSeconds } from '../lib/rate-limit.js';
import { getGitHubRepos } from '../lib/github.js';
import { getInternalRequestHeaders, getUserFromAuthHeader, userHasProjectAccess } from '../lib/request-auth.js';
import { getGitLabToken } from '../lib/gitlab-token.js';

const ALL_PROVIDERS: AIProvider[] = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro', 'genai-mil'];
const OPENAI_FALLBACK_MODEL = 'gpt-4o';
type OpenAiCredentialMode = 'openai' | 'azure_openai';
type OpenAiUserConfig = {
  mode?: OpenAiCredentialMode;
  endpoint?: string;
  preferredModel?: string;
  enabledModels?: string[];
};

interface GitLabIntegrationConfig {
  repoUrl?: string;
  repoPath?: string;
  repo?: string;
  repos?: string[];
  token?: string;
  tokenEncrypted?: string;
  tokenIv?: string;
  tokenAuthTag?: string;
  host?: string;
}

function isOpenAiProviderSelection(provider: string): provider is OpenAiProviderSelection {
  return provider.startsWith('openai:');
}

// Map provider selection to the service name stored in user_ai_keys table
function providerToService(provider: AIProviderSelection): 'anthropic' | 'openai' | 'google' | 'google_ai' {
  if (provider === 'gpt-4o' || isOpenAiProviderSelection(provider)) return 'openai';
  if (provider === 'gemini-pro') return 'google_ai'; // Google AI Studio keys (AIza…)
  if (provider === 'genai-mil') return 'google';     // DoD STARK keys still live in 'google' slot
  return 'anthropic'; // claude-haiku, claude-sonnet, claude-opus
}

function normalizeAgentValue(agent: string): AIProviderSelection | null {
  if (ALL_PROVIDERS.includes(agent as AIProvider)) return agent as AIProvider;
  if (isOpenAiProviderSelection(agent) && agent.slice('openai:'.length).trim().length > 0) return agent;
  return null;
}

function filterOpenAiModelIds(modelIds: string[]): string[] {
  const excluded = /(audio|embedding|moderation|whisper|tts|transcri|image|dall|realtime|search-preview|computer-use)/i;
  const included = /^(gpt|o1|o3|o4|codex)/i;

  return [...new Set(
    modelIds
      .filter((id) => included.test(id) && !excluded.test(id))
      .sort((a, b) => a.localeCompare(b)),
  )];
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

function normalizeOpenAiPreferredModel(model: string | null | undefined): string {
  return model?.trim() ?? '';
}

function mergeOpenAiModels(modelIds: string[], preferredModel?: string | null): string[] {
  const normalizedPreferred = normalizeOpenAiPreferredModel(preferredModel);
  return [...new Set([
    ...(normalizedPreferred ? [normalizedPreferred] : []),
    ...modelIds.map((id) => id.trim()).filter(Boolean),
  ])];
}

function normalizeConfiguredModelIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function uniqueNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const local = email.split('@')[0]?.trim();
  return local || null;
}

function getEnabledModelsFromConfig(config: unknown): string[] {
  if (!config || typeof config !== 'object') return [];
  return normalizeConfiguredModelIds((config as { enabledModels?: unknown }).enabledModels);
}

const DEFAULT_ANTHROPIC_MODELS: AIProvider[] = ['claude-haiku', 'claude-sonnet', 'claude-opus'];

function getConfiguredVisibleModels(
  configured: string[] | null | undefined,
  defaults: string[],
  preferredModel?: string | null,
): string[] {
  const selected = normalizeConfiguredModelIds(configured);
  if (selected.length > 0) return selected;

  const normalizedPreferred = normalizeOpenAiPreferredModel(preferredModel);
  if (normalizedPreferred) return [normalizedPreferred];

  const strongest = pickMostCapableModelId(defaults);
  return strongest ? [strongest] : defaults.slice(0, 1);
}

function getPrimaryModelSelection(modelIds: string[], preferredModel?: string | null): string {
  const normalizedPreferred = normalizeOpenAiPreferredModel(preferredModel);
  if (normalizedPreferred) return normalizedPreferred;

  const normalizedIds = normalizeConfiguredModelIds(modelIds);
  if (normalizedIds.length > 0) return normalizedIds[0];

  return pickMostCapableModelId(modelIds);
}

function normalizeGitLabHost(host: string): string {
  return host.trim().replace(/\/+$/, '');
}

function getGitLabRepoPaths(config: GitLabIntegrationConfig | null | undefined): string[] {
  const repos = (config?.repos ?? []).map((value) => value.trim()).filter(Boolean);
  const repoPath = config?.repoPath?.trim();
  const repo = config?.repo?.trim();
  return [...new Set([repoPath, ...repos, repo].filter((value): value is string => !!value))];
}

function getGitLabHost(config: GitLabIntegrationConfig | null | undefined): string {
  if (config?.host?.trim()) return normalizeGitLabHost(config.host);
  if (config?.repoUrl?.trim()) {
    try {
      return normalizeGitLabHost(new URL(config.repoUrl).origin);
    } catch {
      return '';
    }
  }
  return '';
}

// Prefer order when auto-selecting from stored user keys
const AUTO_PROVIDER_PREFERENCE: AIProvider[] = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'gemini-pro', 'gpt-4o'];

/**
 * Resolve the best available provider for a given auth token.
 * When the user has a personal key stored in the DB, prefer that service.
 * Falls back to `fallback` only as a final default selection hint.
 */
async function resolveAutoProvider(authHeader: string | undefined, fallback: AIProviderSelection): Promise<AIProviderSelection> {
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) {
      const { data: keys } = await supabase
        .from('user_ai_keys')
        .select('provider, config')
        .eq('user_id', user.id);
      if (keys && keys.length > 0) {
        const storedServices = new Set(keys.map((k: { provider: string }) => k.provider));
        const configsByService = new Map(
          keys.map((k: { provider: string; config?: unknown }) => [k.provider, k.config]),
        );
        // Pick the first provider (in preference order) whose service has a stored key
        for (const p of AUTO_PROVIDER_PREFERENCE) {
          const service = providerToService(p);
          if (!storedServices.has(service)) continue;

          const configuredVisibleModels = getEnabledModelsFromConfig(configsByService.get(service));
          if (service === 'anthropic' && configuredVisibleModels.length > 0 && !configuredVisibleModels.includes(p)) continue;
          if (service === 'google_ai' && configuredVisibleModels.length > 0 && !configuredVisibleModels.includes('gemini-pro')) continue;
          if (service === 'google' && configuredVisibleModels.length > 0 && !configuredVisibleModels.includes('genai-mil')) continue;

          return p;
        }
      }
    }
  }
  if (getServerOpenAiCredential()?.apiKey) {
    return `openai:${getServerOpenAiPrimaryModel(OPENAI_FALLBACK_MODEL)}`;
  }
  return fallback;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, '');
}

function isGenAiMilCredential(credential: ProviderCredentialOverride | undefined): boolean {
  if (!credential) return false;
  return isGenAiMilKey(typeof credential === 'string' ? credential : credential.apiKey);
}

// Look up the user's stored API key for the given provider (decrypted).
// Returns undefined if not found or auth fails.
async function getUserApiKey(authHeader: string | undefined, provider: AIProviderSelection): Promise<ProviderCredentialOverride | undefined> {
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return undefined;

  const service = providerToService(provider);
  const { data, error } = await supabase
    .from('user_ai_keys')
    .select('encrypted_key, iv, auth_tag, config')
    .eq('user_id', user.id)
    .eq('provider', service)
    .maybeSingle();

  if (error || !data) return undefined;

  try {
    const apiKey = decryptUserKey(data.encrypted_key, data.iv, data.auth_tag);
    if (service !== 'openai') return apiKey;

    const config = (data.config ?? {}) as { mode?: string; endpoint?: string };
    if (config.mode === 'azure_openai') {
      const endpoint = typeof config.endpoint === 'string' ? normalizeEndpoint(config.endpoint) : '';
      if (endpoint) {
        return {
          apiKey,
          baseURL: endpoint,
          authMode: 'api-key',
        };
      }
    }

    return apiKey;
  } catch {
    return undefined;
  }
}

async function getOpenAiUserConfig(authHeader: string | undefined): Promise<OpenAiUserConfig | undefined> {
  if (!authHeader?.startsWith('Bearer ')) return undefined;
  const token = authHeader.slice(7);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return undefined;

  const { data, error } = await supabase
    .from('user_ai_keys')
    .select('config')
    .eq('user_id', user.id)
    .eq('provider', 'openai')
    .maybeSingle();

  if (error || !data || !data.config || typeof data.config !== 'object') return undefined;
  const raw = data.config as { mode?: unknown; endpoint?: unknown; preferredModel?: unknown; enabledModels?: unknown };
  return {
    mode: raw.mode === 'azure_openai' ? 'azure_openai' : 'openai',
    ...(typeof raw.endpoint === 'string' && raw.endpoint.trim() ? { endpoint: raw.endpoint.trim() } : {}),
    ...(typeof raw.preferredModel === 'string' && raw.preferredModel.trim() ? { preferredModel: raw.preferredModel.trim() } : {}),
    ...(Array.isArray(raw.enabledModels)
      ? {
          enabledModels: raw.enabledModels
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        }
      : {}),
  };
}

async function listOpenAiModels(credential: ProviderCredentialOverride | undefined): Promise<string[]> {
  if (!credential) return [];

  const apiKey = typeof credential === 'string' ? credential : credential.apiKey;
  const baseURL = typeof credential === 'string' ? undefined : credential.baseURL;
  const authMode = typeof credential === 'string' ? 'bearer' : credential.authMode;
  if (!apiKey) return [];

  const client = new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(authMode === 'api-key' ? { defaultHeaders: { 'api-key': apiKey } } : {}),
  });

  const response = await client.models.list();
  const ids = response.data.map((model) => model.id);
  const filtered = filterOpenAiModelIds(ids);
  if (filtered.length > 0) return filtered;
  return ids.includes(OPENAI_FALLBACK_MODEL) ? [OPENAI_FALLBACK_MODEL] : [];
}

async function getOpenAiModelsForRequest(authHeader: string | undefined): Promise<string[]> {
  const userConfig = await getOpenAiUserConfig(authHeader);
  const configuredAzureDeployments = mergeOpenAiModels(
    normalizeConfiguredModelIds(userConfig?.enabledModels ?? []),
    userConfig?.preferredModel,
  );

  if (userConfig?.mode === 'azure_openai') {
    return configuredAzureDeployments;
  }

  const userCredential = await getUserApiKey(authHeader, 'gpt-4o');
  const credential = userCredential ?? getServerOpenAiCredential();

  if (!credential) {
    const merged = mergeOpenAiModels([], userConfig?.preferredModel);
    return normalizeOpenAiModelIds(merged);
  }

  try {
    const models = await listOpenAiModels(credential);
    const merged = mergeOpenAiModels(models, userConfig?.preferredModel);
    if (merged.length > 0) {
      return normalizeOpenAiModelIds(merged);
    }
  } catch {
    // Fall through to the standard fallback model below.
  }

  const merged = mergeOpenAiModels([getServerOpenAiPrimaryModel(OPENAI_FALLBACK_MODEL)], userConfig?.preferredModel);
  return normalizeOpenAiModelIds(merged);
}

// Strip markdown code fences that models sometimes wrap JSON responses in.
// e.g. ```json { ... } ``` → { ... }
function extractJson(text: string): string {
  // Extract JSON from ```json ... ``` fences only — do NOT match bash/sh/etc. fences
  // which would grab shell code instead of JSON when the model wraps both in code blocks.
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1].trim() : text.trim();

  // Find the outermost JSON object/array — strips any conversational preamble
  // e.g. "Of course, here is the JSON: {..." → "{..."
  const firstBrace = raw.indexOf('{');
  const firstBracket = raw.indexOf('[');
  const start = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);
  if (start > 0) raw = raw.slice(start);
  // Also trim everything after the final closing brace/bracket
  const lastBrace = raw.lastIndexOf('}');
  const lastBracket = raw.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end >= 0 && end < raw.length - 1) raw = raw.slice(0, end + 1);

  // Strip JS-style line comments (// ...) — invalid in JSON
  raw = raw.replace(/\/\/[^\n]*/g, '');
  // Strip block comments (/* ... */) — invalid in JSON
  raw = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  // Fix trailing commas before } or ] — invalid in JSON
  raw = raw.replace(/,(\s*[}\]])/g, '$1');

  return raw.trim();
}

// Resolve the provider from the request body.
// When agent === 'auto' or is unset, the caller's `fallback` is used —
// each endpoint passes the tier appropriate for its task complexity.
function resolveProvider(body: { agent?: string }, fallback: AIProviderSelection = 'claude-haiku'): AIProviderSelection {
  const agent = body.agent;
  if (agent && agent !== 'auto') {
    const normalized = normalizeAgentValue(agent);
    if (normalized) return normalized;
  }
  return fallback;
}

// Chat-specific auto-routing: choose model based on message complexity
function resolveProviderForChat(body: { agent?: string }, lastMessage: string): AIProviderSelection {
  if (body.agent && body.agent !== 'auto') {
    const normalized = normalizeAgentValue(body.agent);
    if (normalized) return normalized;
  }
  const words = lastMessage.trim().split(/\s+/).length;
  const deepKeywords = /analyz|comprehensive|deep dive|explain in detail|walk me through|compare|evaluate|assess|design|architect/i;
  if (words > 80 || deepKeywords.test(lastMessage)) return 'claude-sonnet';
  if (words > 20) return 'claude-sonnet';
  return 'claude-haiku';
}

interface AISummarizeBody {
  agent?: string;
  projectName: string;
  events: {
    source: string;
    event_type: string;
    title: string;
    summary?: string;
    occurred_at: string;
    metadata?: Record<string, unknown>;
  }[];
  goals?: {
    title: string;
    status: string;
    progress: number;
    deadline?: string;
  }[];
  queryType: 'activity_summary' | 'deadline_risk' | 'contribution' | 'project_history';
  userQuestion?: string;
}

const MD_STYLE = `Use rich markdown formatting — the UI renders it fully. Use **bold** for key terms and task names, \`backticks\` for file names and identifiers, headers (## ###) to organize longer responses, bullet and numbered lists for structure, > blockquotes for caveats, and fenced code blocks for code. Never use emojis. Always refer to tasks by their title, never by ID.`;

const systemPrompts: Record<string, string> = {
  activity_summary: `You are Odyssey's AI intelligence layer. Summarize recent project activity concisely. Focus on:
- Key developments and progress
- Notable patterns or changes in velocity
- Areas of high/low activity
Keep your response under 200 words. Use a professional, direct tone. ${MD_STYLE}`,

  deadline_risk: `You are Odyssey's deadline risk analyzer. Evaluate whether the project is on track for its goals. Consider:
- Current progress vs. deadline proximity
- Recent activity velocity
- Goal completion rates
Rate risk as: **ON TRACK**, **AT RISK**, or **BEHIND SCHEDULE**. Explain why in 2-3 sentences. ${MD_STYLE}`,

  contribution: `You are Odyssey's contribution analyst. Map who contributed what based on the event data. Focus on:
- Which areas each contributor focused on
- Volume and frequency of contributions
- Key accomplishments per contributor
Be factual and data-driven. ${MD_STYLE}`,

  project_history: `You are Odyssey's project historian. Tell the story of how this project evolved based on the event timeline. Focus on:
- Major milestones and turning points
- How different workstreams came together
- The overall arc of development
Write as a narrative, under 300 words. ${MD_STYLE}`,
};

// Server-side per-user cache for the providers response — avoids repeated DB
// decryption and any external lookups on every page load / component mount.
const providersCache = new Map<string, { result: unknown; ts: number }>();
const PROVIDERS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

async function ensureProjectAccess(
  reply: FastifyReply,
  authHeader: string | undefined,
  projectId: string,
): Promise<string | null> {
  const userId = await getUserFromAuthHeader(authHeader);
  if (!userId) {
    await reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }

  const allowed = await userHasProjectAccess(projectId, userId);
  if (!allowed) {
    await reply.status(403).send({ error: 'Forbidden' });
    return null;
  }

  return userId;
}

export async function aiRoutes(server: FastifyInstance) {
  // ── Available providers endpoint ──
  // Returns user-key availability enriched with per-user key detection.
  server.get<{ Querystring: { refresh?: string } }>('/ai/providers', async (request) => {
    const base = getAvailableProviders();
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) return { providers: base };
    const forceRefresh = request.query?.refresh === '1' || request.query?.refresh === 'true';

    // Return cached result if fresh enough
    const cached = providersCache.get(authHeader);
    if (!forceRefresh && cached && Date.now() - cached.ts < PROVIDERS_CACHE_TTL_MS) {
      return cached.result;
    }

    try {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) return { providers: base };

      // Fetch full key rows so we can decrypt and inspect
      const { data: keys } = await supabase
        .from('user_ai_keys')
        .select('provider, encrypted_key, iv, auth_tag, config')
        .eq('user_id', user.id);

      const userServices = new Set((keys ?? []).map((k: { provider: string }) => k.provider));
      const anthropicRow = (keys ?? []).find((k: { provider: string }) => k.provider === 'anthropic') as
        { provider: string; encrypted_key: string; iv: string; auth_tag: string; config?: { enabledModels?: unknown } } | undefined;
      let anthropicCredential: string | undefined;
      if (anthropicRow) {
        try {
          anthropicCredential = decryptUserKey(anthropicRow.encrypted_key, anthropicRow.iv, anthropicRow.auth_tag);
        } catch { /* ignore */ }
      }

      // ── Decrypt user's 'google' slot to distinguish STARK vs Google AI Studio ──
      let userStarkKey: string | undefined;
      let userGoogleAiCredential: string | undefined;
      let userGoogleAiKeyPresent = userServices.has('google_ai');
      const openAiRow = (keys ?? []).find((k: { provider: string }) => k.provider === 'openai') as
        { provider: string; encrypted_key: string; iv: string; auth_tag: string; config?: OpenAiUserConfig } | undefined;
      const openAiPreferredModel = normalizeOpenAiPreferredModel(openAiRow?.config?.preferredModel);
      let openAiCredential: ProviderCredentialOverride | undefined;
      if (openAiRow) {
        try {
          const apiKey = decryptUserKey(openAiRow.encrypted_key, openAiRow.iv, openAiRow.auth_tag);
          openAiCredential = openAiRow.config?.mode === 'azure_openai' && openAiRow.config?.endpoint
            ? { apiKey, baseURL: normalizeEndpoint(openAiRow.config.endpoint), authMode: 'api-key' }
            : apiKey;
        } catch { /* ignore */ }
      }
      const googleAiRow = (keys ?? []).find((k: { provider: string }) => k.provider === 'google_ai') as
        { provider: string; encrypted_key: string; iv: string; auth_tag: string; config?: { enabledModels?: unknown } } | undefined;
      if (googleAiRow) {
        try {
          userGoogleAiCredential = decryptUserKey(googleAiRow.encrypted_key, googleAiRow.iv, googleAiRow.auth_tag);
        } catch {
          userGoogleAiKeyPresent = false;
        }
      }
      const googleRow = (keys ?? []).find((k: { provider: string }) => k.provider === 'google') as
        { provider: string; encrypted_key: string; iv: string; auth_tag: string; config?: { enabledModels?: unknown } } | undefined;
      if (googleRow) {
        try {
          const decrypted = decryptUserKey(googleRow.encrypted_key, googleRow.iv, googleRow.auth_tag);
          if (isGenAiMilKey(decrypted)) userStarkKey = decrypted;
        } catch { /* decryption failure — treat as absent */ }
      }

      const genaiMilModel = userStarkKey ? (process.env.GENAI_MIL_MODEL ?? 'gemini-2.5-flash') : undefined;
      const openAiMode = openAiRow?.config?.mode === 'azure_openai' ? 'azure_openai' : 'openai';
      const serverOpenAiCredential = getServerOpenAiCredential();
      const openAiModels = await getOpenAiModelsForRequest(authHeader);
      const openAiPreferredModelCanonical = openAiMode === 'azure_openai'
        ? openAiPreferredModel
        : canonicalizeOpenAiModelId(openAiPreferredModel, openAiModels);
      const openAiConfiguredModels = getEnabledModelsFromConfig(openAiRow?.config);
      const openAiConfiguredModelsCanonical = openAiMode === 'azure_openai'
        ? openAiConfiguredModels
        : normalizeOpenAiModelIds(openAiConfiguredModels.map((modelId) => canonicalizeOpenAiModelId(modelId, openAiModels)));
      const anthropicEnabledModels = getConfiguredVisibleModels(getEnabledModelsFromConfig(anthropicRow?.config), DEFAULT_ANTHROPIC_MODELS);
      const openAiEnabledModels = getConfiguredVisibleModels(openAiConfiguredModelsCanonical, openAiModels, openAiPreferredModelCanonical);
      const googleAiEnabledModels = getConfiguredVisibleModels(getEnabledModelsFromConfig(googleAiRow?.config), ['gemini-pro']);
      const genAiEnabledModels = getConfiguredVisibleModels(getEnabledModelsFromConfig(googleRow?.config), ['genai-mil']);
      const openAiPrimaryModel = getPrimaryModelSelection(openAiEnabledModels, openAiPreferredModelCanonical)
        || getPrimaryModelSelection(openAiModels, openAiPreferredModelCanonical);

      const geminiProStatus = userGoogleAiCredential
        ? (getCachedProviderStatus('gemini-pro', userGoogleAiCredential) ?? 'ready')
        : 'no_key';
      const geminiProAvailable = !!userGoogleAiCredential && geminiProStatus === 'ready';
      const genAiMilStatus = userStarkKey
        ? (getCachedProviderStatus('genai-mil', userStarkKey) ?? 'ready')
        : 'no_key';
      const genAiMilAvailable = !!userStarkKey && genAiMilStatus === 'ready';
      const effectiveOpenAiCredential = openAiCredential ?? serverOpenAiCredential;
      const openAiStatus = effectiveOpenAiCredential
        ? (getCachedProviderStatus('gpt-4o', effectiveOpenAiCredential) ?? 'ready')
        : 'no_key';

      const enriched = base.map((p) => {
        if (p.id === 'genai-mil') {
          return {
            ...p,
            available: genAiMilAvailable,
            status: genAiMilStatus,
            userKeyLinked: !!userStarkKey,
            keySource: userStarkKey ? 'user' : 'none',
            visibleModels: genAiEnabledModels,
            ...(genaiMilModel ? { activeModel: genaiMilModel } : {}),
          };
        }

        if (p.id === 'gemini-pro') {
          return {
            ...p,
            available: geminiProAvailable,
            status: geminiProStatus,
            userKeyLinked: userGoogleAiKeyPresent,
            keySource: userGoogleAiKeyPresent ? 'user' : 'none',
            visibleModels: googleAiEnabledModels,
          };
        }

        const service = providerToService(p.id as AIProvider);
        const hasUserKey = userServices.has(service);
        const status: typeof p.status = service === 'anthropic'
          ? (anthropicCredential ? (getCachedProviderStatus(p.id, anthropicCredential) ?? 'ready') : 'no_key')
          : p.id === 'gpt-4o'
            ? openAiStatus
            : 'no_key';
        const available = (service === 'openai' ? !!effectiveOpenAiCredential : hasUserKey) && status === 'ready';
        return {
          ...p,
          available,
          status,
          userKeyLinked: hasUserKey,
          keySource: service === 'openai'
            ? (hasUserKey ? 'user' : effectiveOpenAiCredential ? 'server' : 'none')
            : (hasUserKey ? 'user' : 'none'),
          ...(service === 'anthropic' ? { visibleModels: anthropicEnabledModels.includes(p.id) ? [p.id] : [] } : {}),
          ...(p.id === 'gpt-4o'
            ? {
                models: mergeOpenAiModels(openAiModels, openAiPrimaryModel),
                visibleModels: openAiEnabledModels.map((model) => `openai:${model}`),
                ...(openAiPrimaryModel ? { activeModel: openAiPrimaryModel } : {}),
              }
            : {}),
        };
      });

      const result = { providers: enriched };
      providersCache.set(authHeader, { result, ts: Date.now() });
      return result;
    } catch {
      return { providers: base };
    }
  });

  // ── Commit history: aggregate commits from all linked GitHub + GitLab repos ──
  server.get<{ Params: { projectId: string } }>('/projects/:projectId/commit-history', async (request, reply) => {
    const { projectId } = request.params;
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const [projectRes, gitlabRes] = await Promise.all([
      supabase.from('projects').select('github_repo, github_repos').eq('id', projectId).single(),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
    ]);

    const githubRepos = getGitHubRepos(projectRes.data);
    const gitlabCfg = gitlabRes.data?.config as GitLabIntegrationConfig | null;
    const gitlabRepos = getGitLabRepoPaths(gitlabCfg);
    const gitlabHost = getGitLabHost(gitlabCfg);
    const gitlabToken = getGitLabToken(gitlabCfg);

    const countByDate = new Map<string, number>();
    // repoKey -> date -> count, for per-repo tooltip breakdown
    const repoBreakdown = new Map<string, Map<string, number>>();
    // Individual recent commits for the feed (author, message, date, repo, source)
    interface RecentCommit { sha: string; date: string; author: string; message: string; repo: string; source: 'github' | 'gitlab'; }
    const recentCommits: RecentCommit[] = [];

    function addCommit(repoKey: string, date: string) {
      countByDate.set(date, (countByDate.get(date) ?? 0) + 1);
      if (!repoBreakdown.has(repoKey)) repoBreakdown.set(repoKey, new Map());
      const rm = repoBreakdown.get(repoKey)!;
      rm.set(date, (rm.get(date) ?? 0) + 1);
    }

    // 52-week lookback window
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 364);
    const sinceIso = oneYearAgo.toISOString();

    // GitHub commits — paginate until we've covered a full year
    for (const githubRepo of githubRepos) {
      const [owner, repo] = githubRepo.split('/');
      const token = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (token) ghHeaders.Authorization = `Bearer ${token}`;
      const repoKey = `github:${githubRepo}`;
      for (let page = 1; page <= 13; page++) {
        try {
          const r = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?since=${sinceIso}&per_page=100&page=${page}`,
            { headers: ghHeaders }
          );
          if (!r.ok) break;
          const commits: { sha: string; commit: { author: { name: string; date: string }; message: string } }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) {
            const date = c.commit.author.date.slice(0, 10);
            addCommit(repoKey, date);
            if (page === 1) {
              recentCommits.push({
                sha: c.sha.slice(0, 7),
                date: c.commit.author.date,
                author: c.commit.author.name,
                message: c.commit.message.split('\n')[0].slice(0, 80),
                repo: githubRepo,
                source: 'github',
              });
            }
          }
          if (commits.length < 100) break;
        } catch { break; }
      }
    }

    // GitLab commits — paginate with since filter, up to 13 pages per repo
    if (gitlabToken && gitlabHost) for (const repo of gitlabRepos) {
      const encoded = encodeURIComponent(repo);
      const repoKey = `gitlab:${repo}`;
      const repoLabel = repo.includes('/') ? repo.split('/').slice(-2).join('/') : repo;
      for (let page = 1; page <= 13; page++) {
        try {
          const r = await fetch(
            `${gitlabHost}/api/v4/projects/${encoded}/repository/commits?since=${sinceIso}&per_page=100&page=${page}&order_by=created_at&sort=desc`,
            { headers: gitlabToken ? { 'PRIVATE-TOKEN': gitlabToken } : {} }
          );
          if (!r.ok) break;
          const commits: { id: string; created_at: string; author_name: string; title: string }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) {
            addCommit(repoKey, c.created_at.slice(0, 10));
            if (page === 1) {
              recentCommits.push({
                sha: c.id.slice(0, 7),
                date: c.created_at,
                author: c.author_name,
                message: c.title.slice(0, 80),
                repo: repoLabel,
                source: 'gitlab',
              });
            }
          }
          if (commits.length < 100) break;
        } catch { break; }
      }
    }

    const commits = Array.from(countByDate.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Build per-repo breakdown: { repo, source, dateMap: { [date]: count } }
    const byRepo = Array.from(repoBreakdown.entries()).map(([repoKey, dateMap]) => {
      const colonIdx = repoKey.indexOf(':');
      return {
        source: repoKey.slice(0, colonIdx) as 'github' | 'gitlab',
        repo: repoKey.slice(colonIdx + 1),
        dateMap: Object.fromEntries(dateMap.entries()),
      };
    });

    // Sort recent commits by date desc, keep top 25
    recentCommits.sort((a, b) => b.date.localeCompare(a.date));
    const topRecent = recentCommits.slice(0, 25);

    return reply.send({ commits, byRepo, recentCommits: topRecent });
  });

  server.post<{ Body: AISummarizeBody }>('/ai/summarize', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, events, goals, queryType, userQuestion } = request.body;

    if (!projectName || !events || !queryType) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    // Build context within ~16000 chars
    const eventsSummary = events
      .slice(0, 20)
      .map((e) => `[${e.occurred_at}] ${e.source}/${e.event_type}: ${e.title}`)
      .join('\n');

    const goalsSummary = goals
      ? goals
          .map((g) => `- ${g.title} (${g.status}, ${g.progress}%${g.deadline ? `, due: ${g.deadline}` : ''})`)
          .join('\n')
      : 'No goals set';

    // Include extracted text from uploaded documents
    const docEvents = events.filter((e) => e.event_type === 'file_upload');
    const docsSection = docEvents.length > 0
      ? '\n\nUPLOADED DOCUMENTS:\n' + docEvents.map((e) => {
          const meta = e.metadata as { extracted_text?: string; filename?: string } | null;
          const text = meta?.extracted_text;
          if (!text) return null;
          const fname = meta?.filename || e.title;
          return `[${fname}]\n${text.slice(0, 10_000)}`;
        }).filter(Boolean).join('\n\n')
      : '';

    const userContent = `Project: ${projectName}

Recent Events (newest first):
${eventsSummary || 'No events yet'}

Goals:
${goalsSummary}${docsSection}

${userQuestion ? `User Question: ${userQuestion}` : `Provide a ${queryType.replace('_', ' ')} analysis.`}`;

    try {
      const result = await chat(provider, {
        system: systemPrompts[queryType] || systemPrompts.activity_summary,
        user: userContent,
        maxTokens: 1024,
      });

      return {
        summary: result.text,
        queryType,
        provider: result.provider,
      };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to generate AI summary' });
    }
  });

  // ── Categorize goals into topic categories ──
  interface CategorizeBody {
    agent?: string;
    projectName: string;
    goals: { id: string; title: string; status: string }[];
    categories: string[];
  }

  server.post<{ Body: CategorizeBody }>('/ai/categorize', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, goals, categories } = request.body;

    if (!goals || !categories || goals.length === 0) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const goalsList = goals.map((g) => `- ID: ${g.id} | Title: "${g.title}" | Status: ${g.status}`).join('\n');

    try {
      const result = await chat(provider, {
        system: `You categorize project goals into topic categories. Respond ONLY with valid JSON — no markdown, no explanation. The JSON should be an object mapping goal IDs to category names.`,
        user: `Project: ${projectName}\n\nGoals:\n${goalsList}\n\nAvailable categories: ${categories.join(', ')}\n\nAssign each goal to the single most relevant category. Return JSON like: {"goal-id-1": "Category", "goal-id-2": "Category"}`,
        maxTokens: 512,
        jsonMode: true,
      });

      const parsed = JSON.parse(extractJson(result.text));
      return { categories: parsed, provider: result.provider };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to categorize goals' });
    }
  });

  // ── Scan repo to evaluate goals and suggest new ones ──
  interface RepoScanBody {
    agent?: string;
    projectName: string;
    goals: { id: string; title: string; status: string; progress: number }[];
    commits: string[];
    readme: string;
  }

  server.post<{ Body: RepoScanBody }>('/ai/repo-scan', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectName, goals, commits, readme } = request.body;

    if (!projectName || !goals) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }

    const goalsList = goals.map((g) =>
      `- [${g.id}] "${g.title}" — status: ${g.status}, progress: ${g.progress}%`
    ).join('\n');

    const commitsList = (commits || []).slice(0, 30).join('\n');

    try {
      const result = await chat(provider, {
        system: `You analyze GitHub repositories to evaluate project goals. Respond ONLY with valid JSON — no markdown, no explanation.

Return an object with two keys:
- "completed": array of goal IDs that appear to be fully completed based on recent commits and the README
- "suggested": array of objects with "title" and "reason" for new goals the project should consider based on what you see in the codebase

Be conservative: only mark goals as completed if the commits clearly show the work is done.
Suggest 2-4 practical, specific goals based on gaps or next steps visible in the code.`,
        user: `Project: ${projectName}

Current Goals:
${goalsList || 'No goals set yet'}

Recent Commits:
${commitsList || 'No commits available'}

README (excerpt):
${readme || 'No README found'}

Analyze which goals are completed and suggest new goals.`,
        maxTokens: 1200,
        jsonMode: true,
      });

      const parsed = JSON.parse(extractJson(result.text));
      return {
        completed: parsed.completed || [],
        suggested: parsed.suggested || [],
        provider: result.provider,
      };
    } catch (err) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to scan repo' });
    }
  });

  // ── Project insights: status, next steps, future features ──
  interface ProjectInsightsBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: ProjectInsightsBody }>('/ai/project-insights', async (request, reply) => {
    const { projectId } = request.body;

    if (!projectId) {
      return reply.status(400).send({ error: 'projectId is required' });
    }

    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const provider = (request.body.agent && request.body.agent !== 'auto')
      ? resolveProvider(request.body, 'claude-sonnet')
      : await resolveAutoProvider(request.headers.authorization, 'claude-sonnet');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);
    const ctx = await getCachedContext(projectId, userId);

    const codeBlock = [
      ctx.githubContext ? `GITHUB (commits + diffs + source):\n${ctx.githubContext.slice(0, 35_000)}` : '',
      ctx.gitlabContext ? `GITLAB (commits + diffs + source):\n${ctx.gitlabContext.slice(0, 35_000)}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's deep project intelligence engine. You have access to ACTUAL SOURCE CODE FILES and REAL COMMIT DIFFS — not just commit messages. Use them to give a technically grounded analysis.

Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly four keys:
Use backtick markdown formatting for all file paths, function names, module names, variable names, and code identifiers (e.g. \`server/src/routes/ai.ts\`, \`resolveProvider()\`, \`GITHUB_TOKEN\`). When referencing repository files, prefer full repo-qualified paths such as \`repo-name/src/components/File.tsx\` instead of ambiguous relative-only paths like \`src/components/File.tsx\`. Use **bold** for emphasis on key terms.

Return an object with exactly four keys:
- "status": 3-4 sentences on the project's current health. Reference specific files, modules, or components you can see actively changing in the diffs. Note velocity trends.
- "nextSteps": Array of 4-6 strings. Each must be a specific, actionable task grounded in what you see in the code — reference actual file names, function names, or modules using backtick formatting. No generic advice.
- "futureFeatures": Array of 3-5 strings. Suggest concrete features based on gaps you can identify in the current codebase structure and what the README/tasks describe but the code doesn't yet implement.
- "codeInsights": Array of 4-6 strings. Deep technical observations: which modules are most actively developed (from diffs), code patterns you notice, potential technical debt, architectural observations, areas that look incomplete or missing tests, etc. Be specific — name files and patterns using backtick formatting.`,
        user: `Project: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}

TASKS (${ctx.goals.length} total):
${ctx.tasksText}

RECENT ACTIVITY:
${ctx.eventsText.slice(0, 2000)}

${codeBlock}`,
        maxTokens: 3000,
        jsonMode: true,
      }, userApiKey);

      let raw = extractJson(result.text);
      // If the response was truncated mid-JSON, attempt to close it gracefully
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const lastBrace = raw.lastIndexOf('}');
        if (lastBrace > 0) raw = raw.slice(0, lastBrace + 1);
        parsed = JSON.parse(raw);
      }
      return {
        status: parsed.status || '',
        nextSteps: parsed.nextSteps || [],
        futureFeatures: parsed.futureFeatures || [],
        codeInsights: parsed.codeInsights || [],
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message || 'Failed to generate insights';
      if (msg.includes('credit balance') || msg.includes('billing')) {
        return reply.status(402).send({ error: 'API key has no credits. Switch to a different AI model or add billing.' });
      }
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Analyze a document (OneNote page, OneDrive file, etc.) ──────────────
  interface AnalyzeDocumentBody {
    agent?: string;
    title: string;
    content: string;        // Plain text content of the document
    projectName?: string;   // Optional project context
  }

  server.post<{ Body: AnalyzeDocumentBody }>('/ai/analyze-document', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { title, content, projectName } = request.body;

    if (!title || !content) {
      return reply.status(400).send({ error: 'title and content are required' });
    }

    // Cap input to keep within token budget (~8k chars ≈ 2k tokens)
    const truncated = content.slice(0, 8000);

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's document intelligence engine. Analyze documents and extract structured insights for a project management context. Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with exactly four keys:
- "summary": A 2-3 sentence summary of what the document is about.
- "keyPoints": An array of 4-6 strings, each a key insight or important point from the document.
- "actionItems": An array of 0-5 strings, each a concrete action item or task mentioned or implied by the document.
- "projectRelevance": A 1-2 sentence note on how this document could inform project decisions or progress.`,
        user: `Document Title: ${title}
${projectName ? `Project Context: ${projectName}\n` : ''}
Document Content:
${truncated}

Analyze this document and extract structured insights.`,
        maxTokens: 1024,
        jsonMode: true,
      });

      const parsed = JSON.parse(extractJson(result.text));
      return {
        summary: parsed.summary || '',
        keyPoints: parsed.keyPoints || [],
        actionItems: parsed.actionItems || [],
        projectRelevance: parsed.projectRelevance || '',
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to analyze document' });
    }
  });

  // ── Analyze office files → update goal progress ───────────────────────────
  interface OfficeProgressBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: OfficeProgressBody }>('/ai/analyze-office-progress', async (request, reply) => {
    const provider = resolveProvider(request.body);
    const { projectId } = request.body;

    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    // Fetch goals + onenote/onedrive events
    const [{ data: goals }, { data: events }, { data: project }] = await Promise.all([
      supabase.from('goals').select('id, title, status, progress, deadline, category, assigned_to').eq('project_id', projectId),
      supabase
        .from('events')
        .select('id, source, event_type, title, summary, metadata, occurred_at, created_by')
        .eq('project_id', projectId)
        .in('source', ['onenote', 'onedrive', 'local'])
        .order('occurred_at', { ascending: false }),
      supabase.from('projects').select('name').eq('id', projectId).single(),
    ]);

    if (!goals?.length) return reply.status(400).send({ error: 'No goals found for this project' });
    if (!events?.length) return reply.status(400).send({ error: 'No imported Office documents found. Import some OneNote pages or OneDrive files first.' });

    // Build document context — include content previews from metadata
    const docsContext = events.map((e) => {
      const meta = e.metadata as { content_preview?: string; modified_by?: string; last_modified?: string; author?: string } | null;
      const modifiedBy = meta?.modified_by ?? meta?.author ?? (e.created_by ? `User ${e.created_by}` : 'Unknown');
      const modifiedAt = meta?.last_modified ?? e.occurred_at;
      let doc = `Document: "${e.title ?? '(untitled)'}"\n`;
      doc += `  Source: ${e.source} | Imported: ${new Date(e.occurred_at).toLocaleDateString()} | Modified by: ${modifiedBy} | Modified at: ${new Date(modifiedAt).toLocaleDateString()}\n`;
      if (e.summary) doc += `  Summary: ${e.summary}\n`;
      if (meta?.content_preview) doc += `  Content: ${meta.content_preview.slice(0, 1200)}\n`;
      return doc;
    }).join('\n---\n');

    const goalsContext = goals.map((g) =>
      `Goal ID: ${g.id}\n  Title: "${g.title}"\n  Status: ${g.status} | Progress: ${g.progress}%${g.deadline ? ` | Deadline: ${g.deadline}` : ''}${g.category ? ` | Category: ${g.category}` : ''}${g.assigned_to ? ` | Assigned to: ${g.assigned_to}` : ''}`
    ).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are an AI progress tracker for a project management platform. Analyze imported documents (from OneNote and OneDrive) to determine which project goals they represent progress on, estimate completion percentages, and identify who did the work based on document metadata.

Respond ONLY with valid JSON — no markdown fences, no explanation outside the JSON.

Return an object with two keys:
- "updates": Array of goal progress updates. Each item must have:
  - "goalId": string (exact goal ID from the input)
  - "progress": number 0–100 (estimated completion %)
  - "status": "active" | "complete" | "at_risk" (infer from content)
  - "completedBy": string or null (person who contributed most, from document metadata)
  - "evidence": string (1-2 sentence explanation of what document content indicates this progress)
  - "lastActivityDate": string ISO date (when this work occurred, from doc modification dates)
- "summary": string (2-3 sentences summarizing what the documents collectively reveal about team progress)

Rules:
- Only include goals that clearly relate to the document content
- Use document modification history (modified_by, last_modified) to determine who did the work
- Be conservative: only mark goals as "complete" if documents strongly indicate all work is done
- If a document shows partial work, estimate a realistic percentage
- If multiple documents relate to the same goal, synthesize them together
- "at_risk" means the work seems stalled, overdue, or has blockers mentioned`,
        user: `Project: ${project?.name ?? 'Unknown'}

GOALS TO EVALUATE:
${goalsContext}

IMPORTED OFFICE DOCUMENTS:
${docsContext}

Analyze which goals these documents show progress on, who did the work, and when.`,
        maxTokens: 2000,
        jsonMode: true,
      });

      const parsed = JSON.parse(extractJson(result.text));
      const updates = parsed.updates ?? [];

      // Apply goal updates to DB
      const applied: string[] = [];
      for (const u of updates) {
        const goal = goals.find((g) => g.id === u.goalId);
        if (!goal) continue;
        const newProgress = Math.min(100, Math.max(0, Math.round(u.progress)));
        // Only update if AI suggests meaningful change or status change
        if (newProgress !== goal.progress || u.status !== goal.status) {
          await supabase.from('goals').update({
            progress: newProgress,
            status: u.status,
            updated_at: new Date().toISOString(),
          }).eq('id', u.goalId);
          applied.push(u.goalId);

          // Log an event for the progress update
          await supabase.from('events').insert({
            project_id: projectId,
            source: 'ai',
            event_type: 'goal_progress_updated',
            title: `AI updated goal: "${goal.title}" → ${newProgress}%`,
            summary: u.evidence,
            metadata: {
              goal_id: u.goalId,
              old_progress: goal.progress,
              new_progress: newProgress,
              completed_by: u.completedBy ?? null,
              last_activity_date: u.lastActivityDate ?? null,
              analyzed_by: provider,
            },
            occurred_at: new Date().toISOString(),
          });
        }
      }

      return {
        updates,
        applied: applied.length,
        summary: parsed.summary ?? '',
        provider: result.provider,
      };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to analyze office progress';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Helper: gather full project context from DB + connected sources ─────────
  async function buildProjectContext(projectId: string, userId?: string | null) {
    const [
      { data: project },
      { data: goals },
      { data: events },
      { data: members },
      { data: gitlabInteg },
      { data: structuredDocuments },
    ] = await Promise.all([
      supabase.from('projects').select('name, description, github_repo, github_repos, created_at, owner_id').eq('id', projectId).single(),
      supabase.from('goals').select('id, title, status, progress, deadline, category, assigned_to').eq('project_id', projectId),
      supabase.from('events').select('source, event_type, title, summary, metadata, occurred_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(50),
      supabase.from('project_members').select('user_id, role').eq('project_id', projectId),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
      supabase.from('project_documents').select('filename, extracted_text, summary, keywords, created_at').eq('project_id', projectId).order('created_at', { ascending: false }).limit(25),
    ]);

    const memberRows = (members ?? []) as Array<{ user_id: string; role: string | null }>;
    const memberUserIds = uniqueNonEmptyStrings(memberRows.map((member) => member.user_id));
    const fallbackOwnerId = memberUserIds.length === 0 && project?.owner_id ? [project.owner_id as string] : [];
    const allProjectUserIds = uniqueNonEmptyStrings([
      ...fallbackOwnerId,
      ...memberUserIds,
    ]);
    const { data: profileRows } = allProjectUserIds.length
      ? await supabase.from('profiles').select('id, display_name, username, email').in('id', allProjectUserIds)
      : { data: [] as Array<{ id: string; display_name: string | null; username: string | null; email: string | null }> };
    const profileMap = new Map((profileRows ?? []).map((profile) => [profile.id, profile]));
    const teamMembers = new Map<string, {
      userId: string;
      role: string;
      displayName: string;
      username: string | null;
      email: string | null;
    }>();

    for (const member of memberRows) {
      const profile = profileMap.get(member.user_id);
      teamMembers.set(member.user_id, {
        userId: member.user_id,
        role: member.role ?? 'member',
        displayName: profile?.display_name?.trim() || profile?.username?.trim() || profile?.email?.trim() || member.user_id,
        username: profile?.username?.trim() || null,
        email: profile?.email?.trim() || null,
      });
    }

    const ownerId = memberUserIds.length === 0 && typeof project?.owner_id === 'string' ? project.owner_id : null;
    if (ownerId) {
      const ownerProfile = profileMap.get(ownerId);
      const existingOwner = teamMembers.get(ownerId);
      if (existingOwner) {
        existingOwner.role = 'owner';
        existingOwner.displayName = ownerProfile?.display_name?.trim() || existingOwner.displayName;
        existingOwner.username = ownerProfile?.username?.trim() || existingOwner.username;
        existingOwner.email = ownerProfile?.email?.trim() || existingOwner.email;
      } else {
        teamMembers.set(ownerId, {
          userId: ownerId,
          role: 'owner',
          displayName: ownerProfile?.display_name?.trim() || ownerProfile?.username?.trim() || ownerProfile?.email?.trim() || ownerId,
          username: ownerProfile?.username?.trim() || null,
          email: ownerProfile?.email?.trim() || null,
        });
      }
    }

    // Tasks list — IDs kept for action proposals in chat, but format uses "task" terminology
    const goalsText = (goals ?? []).map((g) =>
      `- [task_id:${g.id}] [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}${g.assigned_to ? ` assigned:${g.assigned_to}` : ''}`
    ).join('\n') || 'No tasks';

    // Tasks-only text (no IDs) for insights — prevents the AI from parroting UUIDs back to users
    const tasksText = (goals ?? []).map((g) =>
      `- [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}${g.category ? ` [${g.category}]` : ''}`
    ).join('\n') || 'No tasks';

    const membersText = [...teamMembers.values()].map((member) => {
      const aliases = uniqueNonEmptyStrings([
        member.displayName,
        member.username,
        member.email,
        emailLocalPart(member.email),
      ]);
      const aliasText = aliases.length > 0 ? ` aliases:${aliases.map((value) => `"${value}"`).join(', ')}` : '';
      return `- ${member.displayName} (${member.role}) [user_id:${member.userId}]${member.username ? ` [username:${member.username}]` : ''}${member.email ? ` [email:${member.email}]` : ''}${aliasText}`;
    }).join('\n') || 'No members';

    // Separate uploaded documents from regular activity events
    const allEvents = events ?? [];
    const fileEvents = allEvents.filter((e) => e.event_type === 'file_upload');
    const activityEvents = allEvents.filter((e) => e.event_type !== 'file_upload');

    const eventsText = activityEvents.map((e) => {
      let line = `[${new Date(e.occurred_at).toLocaleDateString()}] ${e.source}/${e.event_type}: ${e.title ?? '(untitled)'}`;
      if (e.summary) line += `\n  Summary: ${e.summary}`;
      const meta = e.metadata as { content_preview?: string } | null;
      if (meta?.content_preview) line += `\n  Content: ${meta.content_preview.slice(0, 600)}`;
      return line;
    }).join('\n\n') || 'No activity yet';

    // Build a dedicated documents context with generous per-file and total budgets
    const DOC_PER_FILE = 15_000;
    const DOC_TOTAL    = 50_000;
    let docBudget = DOC_TOTAL;
    const normalizedDocuments = (structuredDocuments?.length
      ? structuredDocuments.map((document) => ({
          name: document.filename ?? 'Unknown file',
          date: document.created_at,
          extractedText: document.extracted_text ?? null,
          summary: document.summary ?? null,
          keywords: Array.isArray(document.keywords) ? document.keywords : [],
        }))
      : fileEvents.map((event) => {
          const meta = event.metadata as {
            filename?: string;
            extracted_text?: string;
            document_summary?: string;
            keywords?: string[];
          } | null;
          return {
            name: meta?.filename ?? event.title ?? 'Unknown file',
            date: event.occurred_at,
            extractedText: meta?.extracted_text ?? null,
            summary: meta?.document_summary ?? null,
            keywords: Array.isArray(meta?.keywords) ? meta.keywords : [],
          };
        }));

    const documentsContext = normalizedDocuments.map((document) => {
      const date = new Date(document.date).toLocaleDateString();
      if (!document.extractedText) return `[${date}] ${document.name}: (no text extracted)`;
      const alloc = Math.min(DOC_PER_FILE, docBudget);
      if (alloc <= 0) return `[${date}] ${document.name}: (document budget exhausted — download to read)`;
      const text = document.extractedText.slice(0, alloc);
      docBudget -= text.length;
      const summary = document.summary ? `Summary: ${document.summary}\n` : '';
      const keywords = document.keywords.length ? `Keywords: ${document.keywords.join(', ')}\n` : '';
      return `[${date}] FILE: ${document.name}\n${summary}${keywords}${text}${document.extractedText.length > alloc ? '\n[...truncated]' : ''}`;
    }).join('\n\n---\n\n') || '';

    // GitHub data — commits, README, code files, and recent commit diffs
    const internalHeaders = getInternalRequestHeaders(userId);
    let githubContext = '';
    for (const githubRepo of getGitHubRepos(project)) {
      const [owner, repo] = githubRepo.split('/');
      const ghToken = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (ghToken) ghHeaders.Authorization = `Bearer ${ghToken}`;
      const BASE = `http://localhost:${process.env.PORT ?? 3000}`;

      // 1. Commits + README
      try {
        const r = await fetch(
          `${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/recent?projectId=${encodeURIComponent(projectId)}`,
          { headers: internalHeaders },
        );
        if (r.ok) {
          const rd = await r.json() as { commits?: string[]; readme?: string };
          if (rd.commits?.length) githubContext += `${githubContext ? '\n\n' : ''}GitHub repo: ${githubRepo}\nCommits:\n${rd.commits.slice(0, 20).join('\n')}`;
          if (rd.readme) githubContext += `\n\nREADME:\n${rd.readme.slice(0, 3000)}`;
        }
      } catch { /* best-effort */ }

      // 2. Recent commit diffs — what actually changed in the last 6 commits
      try {
        const commitsRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=8`,
          { headers: ghHeaders }
        );
        if (commitsRes.ok) {
          const commits: { sha: string; commit: { message: string } }[] = await commitsRes.json();
          const diffParts: string[] = [];
          for (const c of commits.slice(0, 6)) {
            try {
              const detailRes = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${c.sha}`,
                { headers: ghHeaders }
              );
              if (!detailRes.ok) continue;
              const detail: { files?: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] } = await detailRes.json();
              const files = (detail.files ?? []).slice(0, 10).map((f) => {
                let line = `  [${f.status}] ${f.filename} (+${f.additions}/-${f.deletions})`;
                if (f.patch) line += `\n${f.patch.slice(0, 600)}`;
                return line;
              }).join('\n');
              diffParts.push(`── ${c.commit.message.split('\n')[0]}\n${files}`);
            } catch { /* skip single commit */ }
          }
          if (diffParts.length > 0) githubContext += `\n\nRECENT COMMIT DIFFS:\n${diffParts.join('\n\n')}`;
        }
      } catch { /* best-effort */ }

      // 3. Full source code — recursive tree fetch then prioritized file fetch
      const BINARY_EXTS_GH = new Set(['.png','.jpg','.jpeg','.gif','.ico','.pdf','.zip','.tar','.gz','.bin','.onnx','.pt','.weights','.h264','.mp4','.so','.dylib','.exe','.wasm','.pkl','.npy','.npz','.db','.sqlite','.lock']);
      const CODE_EXTS_GH = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h','.txt','.gitignore','.env.example','.svelte','.vue','.rb','.php','.kt','.swift','.cs','.r','.scala','.jl']);
      const ENTRY_NAMES_GH = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
      const CONFIG_NAMES_GH = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','Makefile','Dockerfile','docker-compose.yml','tsconfig.json','vite.config.ts','go.mod','cargo.toml']);
      const tierGH = (f: { path: string; size?: number }) => {
        const name = f.path.split('/').pop()!.toLowerCase();
        if (name.startsWith('readme')) return 1;
        if (ENTRY_NAMES_GH.has(name)) return 2;
        if (CONFIG_NAMES_GH.has(name)) return 3;
        if (f.path.toLowerCase().endsWith('.md')) return 1;
        const ext = '.' + name.split('.').pop()!;
        if (['.py','.ts','.tsx','.js','.jsx'].includes(ext) && (f.size ?? Infinity) < 20_480) return 3;
        return 4;
      };
      try {
        const treeRes = await fetch(
          `${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tree?projectId=${encodeURIComponent(projectId)}`,
          { headers: internalHeaders },
        );
        if (treeRes.ok) {
          const treeData = await treeRes.json() as { files: { path: string; size: number }[] };
          const allFiles = treeData.files ?? [];
          const skippedBinary: string[] = [];
          const skippedLarge: string[] = [];
          const eligible = allFiles.filter((f) => {
            const lower = f.path.toLowerCase();
            const ext = '.' + lower.split('.').pop()!;
            if (BINARY_EXTS_GH.has(ext)) { skippedBinary.push(f.path); return false; }
            if (!CODE_EXTS_GH.has(ext)) { return false; }
            if ((f.size ?? 0) > 102_400) { skippedLarge.push(f.path); return false; }
            return true;
          });
          eligible.sort((a, b) => tierGH(a) - tierGH(b));

          const GH_BUDGET = 60_000; // ~15k tokens — keep total prompt under Anthropic's 200k limit
          let ghBytes = 0;
          const codeLines: string[] = [];
          const skippedBudget: string[] = [];

          for (const f of eligible) {
            if (ghBytes >= GH_BUDGET) { skippedBudget.push(f.path); continue; }
            try {
              const fr = await fetch(
                `${BASE}/api/github/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/file?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(f.path)}`,
                { headers: internalHeaders },
              );
              if (!fr.ok) continue;
              const fd = await fr.json() as { content?: string };
              if (!fd.content) continue;
              const remaining = GH_BUDGET - ghBytes;
              const snippet = fd.content.slice(0, remaining);
              const truncated = fd.content.length > remaining;
              codeLines.push(`### FILE: ${f.path}\n${snippet}${truncated ? '\n[...truncated — file exceeds remaining budget]' : ''}`);
              ghBytes += snippet.length;
            } catch { /* skip unreadable */ }
          }

          const summary = [
            `## REPOSITORY: ${owner}/${repo}`,
            `Files included: ${codeLines.length} / ${allFiles.length} total`,
            `Estimated tokens: ~${Math.round(ghBytes / 4).toLocaleString()}`,
            skippedBinary.length ? `Skipped (binary): ${skippedBinary.length} files` : '',
            skippedLarge.length ? `Skipped (>100KB): ${skippedLarge.length} files` : '',
            skippedBudget.length ? `Skipped (budget): ${skippedBudget.length} files` : '',
          ].filter(Boolean).join('\n');

          githubContext += `\n\n${summary}\n\n${codeLines.join('\n\n')}`;
        }
      } catch { /* best-effort */ }
    }

    // GitLab data (multi-repo support) — commits + README + code files
    let gitlabContext = '';
    if (gitlabInteg?.config) {
      const cfg = gitlabInteg.config as GitLabIntegrationConfig;
      const repos = getGitLabRepoPaths(cfg);
      const glHost = getGitLabHost(cfg);

      if (repos.length > 0 && glHost) {
        const BINARY_EXTS_GL = new Set(['.png','.jpg','.jpeg','.gif','.ico','.pdf','.zip','.tar','.gz','.bin','.onnx','.pt','.weights','.h264','.mp4','.so','.dylib','.exe','.wasm','.pkl','.npy','.npz','.db','.sqlite','.lock']);
        const CODE_EXTS = new Set(['.py','.js','.ts','.jsx','.tsx','.json','.yaml','.yml','.md','.sh','.txt','.html','.css','.toml','.ini','.cfg','.rs','.go','.java','.c','.cpp','.h','.gitignore','.env.example','.svelte','.vue','.rb','.php','.kt','.swift','.cs','.r','.scala','.jl']);
        const ENTRY_NAMES = new Set(['main.py','app.py','index.ts','index.js','server.ts','server.js','main.ts','main.js','__init__.py','manage.py','run.py','wsgi.py','asgi.py']);
        const CONFIG_NAMES = new Set(['package.json','requirements.txt','pyproject.toml','setup.py','setup.cfg','Makefile','Dockerfile','docker-compose.yml','docker-compose.yaml','tsconfig.json','vite.config.ts','vite.config.js','.env.example','CMakeLists.txt','cargo.toml','go.mod']);
        const BASE = `http://localhost:${process.env.PORT ?? 3000}`;
        const TOTAL_BUDGET = 100_000; // ~25k tokens across all repos
        let totalCharsUsed = 0;

        const repoResults = await Promise.allSettled(repos.map(async (repo) => {
          const repoLabel = repos.length > 1 ? ` [${repo}]` : '';
          let repoCtx = '';

          // 1. Commits + README
          try {
            const r = await fetch(
              `${BASE}/api/gitlab/recent?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`,
              { headers: internalHeaders },
            );
            if (r.ok) {
              const rd = await r.json() as { commits?: string[]; readme?: string };
              if (rd.commits?.length) repoCtx += `GitLab${repoLabel} commits:\n${rd.commits.slice(0, 10).join('\n')}\n`;
              if (rd.readme) repoCtx += `\nREADME${repoLabel}:\n${rd.readme.slice(0, 4000)}\n`;
            }
          } catch { /* best-effort */ }

          // 1b. Recent commit diffs
          try {
            const commitsRes = await fetch(
              `${BASE}/api/gitlab/commits?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`,
              { headers: internalHeaders }
            );
            if (commitsRes.ok) {
              const commitsData = await commitsRes.json() as { commits?: { id: string; title: string }[] };
              const commits = commitsData.commits ?? [];
              const diffParts: string[] = [];
              for (const c of commits.slice(0, 6)) {
                try {
                  const diffRes = await fetch(
                    `${BASE}/api/gitlab/commit-diff?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}&sha=${encodeURIComponent(c.id)}`,
                    { headers: internalHeaders }
                  );
                  if (!diffRes.ok) continue;
                  const diffData = await diffRes.json() as {
                    diffs?: { new_path: string; diff: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean }[];
                  };
                  const diffs = diffData.diffs ?? [];
                  const files = diffs.slice(0, 10).map((d) => {
                    const status = d.new_file ? 'added' : d.deleted_file ? 'deleted' : d.renamed_file ? 'renamed' : 'modified';
                    return `  [${status}] ${d.new_path}\n${(d.diff ?? '').slice(0, 600)}`;
                  }).join('\n');
                  diffParts.push(`── ${c.title}\n${files}`);
                } catch { /* skip */ }
              }
              if (diffParts.length > 0) repoCtx += `\nRECENT COMMIT DIFFS${repoLabel}:\n${diffParts.join('\n\n')}\n`;
            }
          } catch { /* best-effort */ }

          // 2. Full source code — recursive tree + prioritized file fetch
          try {
            const treeRes = await fetch(
              `${BASE}/api/gitlab/tree?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}`,
              { headers: internalHeaders },
            );
            if (treeRes.ok) {
              const treeData = await treeRes.json() as { files: { path: string; size?: number }[] };
              const allFiles = treeData.files ?? [];

              const skippedBinary: string[] = [];
              const skippedLarge: string[] = [];
              const eligible = allFiles.filter((f) => {
                const lower = f.path.toLowerCase();
                const ext = '.' + lower.split('.').pop()!;
                if (BINARY_EXTS_GL.has(ext)) { skippedBinary.push(f.path); return false; }
                if (!CODE_EXTS.has(ext) && !lower.endsWith('.env.example')) return false;
                if ((f.size ?? 0) > 102_400) { skippedLarge.push(f.path); return false; }
                return true;
              });

              const tier = (f: { path: string; size?: number }) => {
                const name = f.path.split('/').pop()!.toLowerCase();
                if (name.startsWith('readme')) return 1;
                if (ENTRY_NAMES.has(name)) return 2;
                if (CONFIG_NAMES.has(name)) return 3;
                if (f.path.toLowerCase().endsWith('.md')) return 1;
                const ext = '.' + name.split('.').pop()!;
                if (['.py','.ts','.tsx','.js','.jsx'].includes(ext) && (f.size ?? Infinity) < 20_480) return 3;
                return 4;
              };
              eligible.sort((a, b) => tier(a) - tier(b));

              const REPO_BUDGET = 60_000; // ~15k tokens per repo
              let repoBytesUsed = 0;
              const codeLines: string[] = [];
              const skippedBudget: string[] = [];

              for (const f of eligible) {
                if (repoBytesUsed >= REPO_BUDGET || totalCharsUsed >= TOTAL_BUDGET) { skippedBudget.push(f.path); continue; }
                try {
                  const fr = await fetch(
                    `${BASE}/api/gitlab/file?projectId=${encodeURIComponent(projectId)}&repo=${encodeURIComponent(repo)}&path=${encodeURIComponent(f.path)}`,
                    { headers: internalHeaders },
                  );
                  if (!fr.ok) continue;
                  const fd = await fr.json() as { content?: string };
                  if (!fd.content) continue;
                  const remaining = Math.min(REPO_BUDGET - repoBytesUsed, TOTAL_BUDGET - totalCharsUsed);
                  const snippet = fd.content.slice(0, remaining);
                  const truncated = fd.content.length > remaining;
                  codeLines.push(`### FILE: ${f.path}\n${snippet}${truncated ? '\n[...truncated]' : ''}`);
                  repoBytesUsed += snippet.length;
                  totalCharsUsed += snippet.length;
                } catch { /* skip unreadable file */ }
              }

              const summary = [
                `## REPOSITORY: ${repo}`,
                `Files included: ${codeLines.length} / ${allFiles.length} total`,
                `Estimated tokens: ~${Math.round(repoBytesUsed / 4).toLocaleString()}`,
                skippedBinary.length ? `Skipped (binary): ${skippedBinary.length} files` : '',
                skippedLarge.length ? `Skipped (>100KB): ${skippedLarge.length} files` : '',
                skippedBudget.length ? `Skipped (budget): ${skippedBudget.length} files` : '',
              ].filter(Boolean).join('\n');

              repoCtx += `\n\n${summary}\n\n${codeLines.join('\n\n')}`;
            }
          } catch { /* best-effort */ }

          return repoCtx;
        }));

        for (const result of repoResults) {
          if (result.status === 'fulfilled' && result.value) {
            gitlabContext += '\n' + result.value;
          }
        }
      }
    }

    return { project, goals: goals ?? [], members: [...teamMembers.values()], goalsText, tasksText, membersText, eventsText, documentsContext, githubContext, gitlabContext };
  }

  // Light context: DB-only (no GitHub/GitLab API calls) — used for haiku/simple chat messages
  // Cache project context for 5 min to avoid re-fetching GitHub/GitLab on every chat message
  type ProjectCtx = Awaited<ReturnType<typeof buildProjectContext>>;
  const ctxCache = new Map<string, { data: ProjectCtx; expiresAt: number }>();

  async function getCachedContext(projectId: string, userId?: string | null): Promise<ProjectCtx> {
    const cacheKey = `${projectId}:${userId ?? 'anon'}`;
    const cached = ctxCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = await buildProjectContext(projectId, userId);
    ctxCache.set(cacheKey, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
    return data;
  }

  // ── Project chat: multi-turn conversation with action proposals ──────────
  interface ChatAttachment {
    type: 'image' | 'text-file' | 'document' | 'repo';
    name: string;
    base64?: string;
    mimeType?: string;
    textContent?: string;
    repo?: string;
    repoType?: string;
  }

  interface ChatBody {
    agent?: string;
    projectId: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    reportMode?: boolean;
    attachments?: ChatAttachment[];
  }

  // Hard-cap: total system+user prompt must stay under ~160k tokens (640k chars)
  // to leave room for the response and API overhead within Anthropic's 200k limit.
  const MAX_PROMPT_CHARS = 640_000;
  function capPromptSections(systemPrompt: string, githubSec: string, gitlabSec: string): { sys: string; gh: string; gl: string } {
    const baseLen = systemPrompt.length - githubSec.length - gitlabSec.length;
    const available = MAX_PROMPT_CHARS - baseLen;
    if (available <= 0) return { sys: systemPrompt.slice(0, MAX_PROMPT_CHARS), gh: '', gl: '' };
    const repoTotal = githubSec.length + gitlabSec.length;
    if (repoTotal <= available) return { sys: systemPrompt, gh: githubSec, gl: gitlabSec };
    const ratio = available / repoTotal;
    const ghKeep = Math.floor(githubSec.length * ratio);
    const glKeep = Math.floor(gitlabSec.length * ratio);
    const gh = ghKeep > 50 ? githubSec.slice(0, ghKeep) + '\n[...truncated to fit context limit]' : '';
    const gl = glKeep > 50 ? gitlabSec.slice(0, glKeep) + '\n[...truncated to fit context limit]' : '';
    const newSys = systemPrompt.replace(githubSec, gh).replace(gitlabSec, gl);
    return { sys: newSys, gh, gl };
  }

  const CHAT_STYLE = `\n\nRESPONSE STYLE: Do not use emojis. Use rich markdown formatting throughout your responses — the UI renders it fully. Specifically: use \`backticks\` for ALL file names, function names, variable names, repo names, and code identifiers; use **bold** for key terms, task names, and important values; use *italics* for emphasis; use headers (##, ###) to organize longer responses; use bullet lists and numbered lists wherever structure aids clarity; use > blockquotes for notes or caveats; use fenced code blocks (\`\`\`) for any code snippets. Never output raw special characters as literal formatting — always apply the appropriate markdown element so the rendered output is visually clear and scannable.`;

  const CHAT_STYLE_WITH_REPO_PATHS = `${CHAT_STYLE} When referencing a file from a linked repository, prefer the most specific repo-qualified path you can infer such as \`repo-name/src/components/File.tsx\` or \`org/repo/src/components/File.tsx\`, not just \`src/components/File.tsx\`.`;

  function parseTaskProposals(text: string): { message: string; pendingActions: object[] | null } {
    const actionsMatch = text.match(/<actions>([\s\S]*?)<\/actions>/);
    if (actionsMatch) {
      try {
        const parsed = JSON.parse(actionsMatch[1].trim());
        if (Array.isArray(parsed)) {
          return {
            message: text.replace(/<actions>[\s\S]*?<\/actions>/, '').trim(),
            pendingActions: parsed.filter((entry) => !!entry && typeof entry === 'object'),
          };
        }
      } catch {
        // Fall back to legacy single-action parsing
      }
    }

    const actionMatch = text.match(/<action>([\s\S]*?)<\/action>/);
    if (actionMatch) {
      try {
        const parsed = JSON.parse(actionMatch[1].trim());
        return {
          message: text.replace(/<action>[\s\S]*?<\/action>/, '').trim(),
          pendingActions: parsed && typeof parsed === 'object' ? [parsed] : null,
        };
      } catch {
        // Ignore malformed legacy action
      }
    }

    return { message: text.trim(), pendingActions: null };
  }

  server.post<{ Body: ChatBody }>('/ai/chat', async (request, reply) => {
    const { projectId, messages, reportMode, attachments } = request.body;
    const lastMessage = messages?.[messages.length - 1]?.content ?? '';

    if (!projectId || !messages?.length) {
      return reply.status(400).send({ error: 'projectId and messages are required' });
    }

    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const rlKey = userId;
    if (isRateLimited(rlKey)) {
      return reply.status(429).send({ error: `Rate limit exceeded — max 30 AI requests per minute. Retry in ${resetInSeconds(rlKey)}s.` });
    }

    // Resolve provider: explicit selection wins; auto picks based on user's stored keys
    const explicitAgent = request.body.agent && request.body.agent !== 'auto';
    const provider = explicitAgent
      ? (reportMode ? resolveProvider(request.body, 'claude-sonnet') : resolveProviderForChat(request.body, lastMessage))
      : await resolveAutoProvider(request.headers.authorization, 'claude-sonnet');

    // Look up user's personal API key override for the selected provider
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    // Always use full context so documents and repo code are available
    const ctx = await getCachedContext(projectId, userId);

    const docsSection = ctx.documentsContext
      ? `\n\nUPLOADED DOCUMENTS (full text):\n${ctx.documentsContext}`
      : '';
    // Pass full repo context — budgets are enforced during fetch (200k chars per repo)
    const githubSection = ctx.githubContext
      ? `\n\nGITHUB (commits + full source code):\n${ctx.githubContext}`
      : '';
    const gitlabSection = ctx.gitlabContext
      ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext}`
      : '';

    const systemPrompt = reportMode
      ? `You are Odyssey's report advisor. Help the user plan a project report. Discuss what data to include, suggest insights, and help structure the report. Be concise and specific. Reference actual tasks by their title, code files, and activity from the project data below. Never show task IDs to the user.${CHAT_STYLE_WITH_REPO_PATHS}

PROJECT: ${ctx.project?.name ?? 'Unknown'}
TASKS:\n${ctx.tasksText}
ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}`
      : `You are an AI assistant embedded in Odyssey with full read and write access to this project. You can answer questions, analyze progress, and propose actions on tasks. You have access to the full text of all uploaded documents and the source code of all linked repositories — use them when answering questions.${CHAT_STYLE_WITH_REPO_PATHS}

IMPORTANT: All project data — tasks, members, activity, repository source code, and documents — is provided directly in this prompt. You already have complete access to everything. Never claim you cannot access URLs, webpages, or external resources. Never ask the user to provide data that is already below. Always refer to tasks by their title (e.g. "Fix IR Intrinsic Calibration"), never by their ID. Task IDs are internal and must never appear in your responses.

PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}${getGitHubRepos(ctx.project).length ? `\nGitHub: ${getGitHubRepos(ctx.project).map((repo) => `github.com/${repo}`).join(', ')}` : ''}

TASKS (${ctx.goals.length} total):
${ctx.tasksText}

TASK ACTION TARGETS (for action payloads only; never show these IDs in visible prose):
${ctx.goalsText}

TEAM MEMBERS:
${ctx.membersText}

RECENT ACTIVITY:
${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}

CAPABILITIES: When appropriate, you may propose MULTIPLE task actions in a single response. Put them at the very end of your message using this exact wrapper:
<actions>[
  {
    "id":"short-stable-id",
    "type":"create_goal" | "update_goal" | "delete_goal" | "review_redundancy",
    "title":"Short card title",
    "description":"Human-readable description of the proposed action",
    "reasoning":"1-2 sentences explaining why this specific task action is warranted",
    "args": { ... }
  }
]</actions>

Action args:
- create_goal: {"title":"...","deadline":"YYYY-MM-DD_or_null","category":"...","assignedTo":"user_id_or_null"}
- update_goal: {"goalId":"exact task_id from TASK ACTION TARGETS","goalTitle":"exact task title","updates":{"title":"optional","status":"not_started|in_progress|in_review|complete","progress":0-100,"deadline":"YYYY-MM-DD_or_null","category":"optional","assigned_to":"user_id_or_null"}}
- delete_goal: {"goalId":"exact task_id from TASK ACTION TARGETS","goalTitle":"exact task title"}
- review_redundancy: {"goalIds":["exact task_id from TASK ACTION TARGETS"],"goalTitles":["task title"],"summary":"what appears redundant","recommendedAction":"merge|delete|keep|clarify"}

Rules:
- Keep proposals task-scoped: one card per task mutation or redundancy finding.
- Only emit proposals when clearly relevant.
- If the user asks for another iteration, respond normally and optionally include a new <actions> block.
- Never mention internal IDs in the visible prose outside the JSON block.
- For any action that targets an existing task, copy the exact task_id from TASK ACTION TARGETS. Never emit placeholders such as "exact-id".
- For assignment requests, resolve people using the TEAM MEMBERS aliases above. Match against display name, username, full email, or email local-part.
- If exactly one team member matches the requested person, use that member's user_id in the action payload.
- If there are multiple plausible matches or no confident match, ask a short follow-up question that lists the closest candidate team members and wait for clarification instead of claiming the person is unavailable.
- Only say a person cannot be assigned if there is truly no plausible team-member match in the TEAM MEMBERS list.
- User approval is always required before any automated task mutation executes.`;

    const history = messages.slice(-20);
    const lastMsg = history[history.length - 1]?.content ?? '';
    const transcript = history.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');

    // Build enriched user content from attachments
    let attachmentPrefix = '';
    const imageAttachments: { base64: string; mimeType: string }[] = [];
    for (const att of attachments ?? []) {
      if (att.type === 'image' && att.base64 && att.mimeType) {
        imageAttachments.push({ base64: att.base64, mimeType: att.mimeType });
      } else if ((att.type === 'text-file' || att.type === 'document') && att.textContent) {
        attachmentPrefix += `[Attached: ${att.name}]\n${att.textContent.slice(0, 20_000)}\n---\n\n`;
      } else if (att.type === 'repo' && att.repo) {
        attachmentPrefix += `[Repository context: ${att.repo} (${att.repoType ?? 'git'})]\n`;
      }
    }

    const userContent = attachmentPrefix
      ? `${attachmentPrefix}${transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg}`
      : transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

    // GenAI.mil has a 1M-token (~4M char) context window — pass the full context
    // uncapped so repo/doc contents aren't truncated before reaching the model.
    const usingGenAiMil = provider === 'gemini-pro' && isGenAiMilCredential(userApiKey);
    const finalSystem = usingGenAiMil ? systemPrompt : capPromptSections(systemPrompt, githubSection, gitlabSection).sys;

    try {
      const result = await chat(provider, {
        system: finalSystem,
        user: userContent,
        maxTokens: 4096,
        images: imageAttachments.length ? imageAttachments : undefined,
        webSearch: !usingGenAiMil,
      }, userApiKey);

      const { message: displayMessage, pendingActions } = parseTaskProposals(result.text);
      return { message: displayMessage, pendingActions, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      // Pass through the real error so the client can display the actual provider message
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Chat with real token streaming (SSE) ─────────────────────────────────
  server.post<{ Body: ChatBody }>('/ai/chat-stream', async (request, reply) => {
    const { projectId, messages, reportMode, attachments } = request.body;
    const lastMessage = messages?.[messages.length - 1]?.content ?? '';

    if (!projectId || !messages?.length) {
      return reply.status(400).send({ error: 'projectId and messages are required' });
    }

    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const rlKey = userId;
    if (isRateLimited(rlKey)) {
      return reply.status(429).send({ error: `Rate limit exceeded — max 30 AI requests per minute. Retry in ${resetInSeconds(rlKey)}s.` });
    }

    reply.hijack();
    const res = reply.raw;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const explicitAgentStream = request.body.agent && request.body.agent !== 'auto';
    const provider = explicitAgentStream
      ? (reportMode ? resolveProvider(request.body, 'claude-sonnet') : resolveProviderForChat(request.body, lastMessage))
      : await resolveAutoProvider(request.headers.authorization, 'claude-sonnet');

    // Look up user's personal API key override for the selected provider
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    try {
      send({ type: 'status', text: 'Loading project context…' });
      const ctx = await getCachedContext(projectId, userId);
      send({ type: 'status', text: 'Generating response…' });

      const docsSection = ctx.documentsContext ? `\n\nUPLOADED DOCUMENTS (full text):\n${ctx.documentsContext}` : '';
      const githubSection = ctx.githubContext ? `\n\nGITHUB (commits + full source code):\n${ctx.githubContext}` : '';
      const gitlabSection = ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + full source code):\n${ctx.gitlabContext}` : '';

      const systemPrompt = reportMode
        ? `You are Odyssey's report advisor. Help the user plan a project report. Be concise and specific. Always refer to tasks by their title, never by ID.${CHAT_STYLE_WITH_REPO_PATHS}\n\nPROJECT: ${ctx.project?.name ?? 'Unknown'}\nTASKS:\n${ctx.tasksText}\nACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}`
        : `You are an AI assistant embedded in Odyssey with full read and write access to this project. You can answer questions, analyze progress, and propose actions on tasks.\n\nIMPORTANT: All project data — tasks, members, activity, repository source code, and documents — is provided directly in this prompt. You already have complete access to everything. Never claim you cannot access URLs, webpages, or external resources. Never ask the user to provide data that is already below. Always refer to tasks by their title (e.g. "Fix IR Intrinsic Calibration"), never by their ID. Task IDs are internal and must never appear in your responses.${CHAT_STYLE_WITH_REPO_PATHS}\n\nPROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}${getGitHubRepos(ctx.project).length ? `\nGitHub: ${getGitHubRepos(ctx.project).map((repo) => `github.com/${repo}`).join(', ')}` : ''}\n\nTASKS (${ctx.goals.length} total):\n${ctx.tasksText}\n\nTASK ACTION TARGETS (for action payloads only; never show these IDs in visible prose):\n${ctx.goalsText}\n\nTEAM MEMBERS:\n${ctx.membersText}\n\nRECENT ACTIVITY:\n${ctx.eventsText.slice(0, 3000)}${docsSection}${githubSection}${gitlabSection}\n\nCAPABILITIES: When appropriate, you may propose multiple task actions at the end using:\n<actions>[{"id":"short-stable-id","type":"create_goal"|"update_goal"|"delete_goal"|"review_redundancy","title":"Short card title","description":"...","reasoning":"...","args":{...}}]</actions>\n\nASSIGNMENT RULES:\n- Resolve people using the TEAM MEMBERS aliases above.\n- Match by display name, username, full email, or email local-part.\n- If exactly one team member matches, use that member's user_id.\n- If multiple candidates could match, or no confident match exists, ask a short clarification question listing the closest candidates instead of claiming the person is unavailable.\n- Only say someone cannot be assigned if the TEAM MEMBERS list truly has no plausible match.\n- For any action that targets an existing task, copy the exact task_id from TASK ACTION TARGETS. Never emit placeholders such as \"exact-id\".\n\nUse one array entry per task mutation or redundancy finding. User approval is always required before automated changes execute.`;

      const history = messages.slice(-20);
      const lastMsg = history[history.length - 1]?.content ?? '';
      const transcript = history.slice(0, -1).map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');

      // Build attachment prefix (same as non-stream endpoint)
      let attachmentPrefix = '';
      const imageAttachments: { base64: string; mimeType: string }[] = [];
      for (const att of attachments ?? []) {
        if (att.type === 'image' && att.base64 && att.mimeType) {
          imageAttachments.push({ base64: att.base64, mimeType: att.mimeType });
        } else if ((att.type === 'text-file' || att.type === 'document') && att.textContent) {
          attachmentPrefix += `[Attached: ${att.name}]\n${att.textContent.slice(0, 20_000)}\n---\n\n`;
        } else if (att.type === 'repo' && att.repo) {
          attachmentPrefix += `[Repository context: ${att.repo} (${att.repoType ?? 'git'})]\n`;
        }
      }
      const userContent = attachmentPrefix
        ? `${attachmentPrefix}${transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg}`
        : transcript ? `${transcript}\n\nUser: ${lastMsg}` : lastMsg;

      const usingGenAiMilStream = provider === 'gemini-pro' && isGenAiMilCredential(userApiKey);
      const finalSystemStream = usingGenAiMilStream ? systemPrompt : capPromptSections(systemPrompt, githubSection, gitlabSection).sys;

      let fullText = '';
      const result = await streamChat(
        provider,
        { system: finalSystemStream, user: userContent, maxTokens: 4096, images: imageAttachments.length ? imageAttachments : undefined, webSearch: !usingGenAiMilStream },
        (chunk) => {
          fullText += chunk;
          send({ type: 'token', text: chunk });
        },
        userApiKey,
      );

      const { message: displayMessage, pendingActions } = parseTaskProposals(result.text || fullText);
      send({ type: 'done', message: displayMessage, pendingActions, provider: result.provider });
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed';
      // Pass the full error message through so the client can display the real reason
      send({ type: 'error', message: msg });
    }

    res.end();
  });

  // ── Generate structured report content ────────────────────────────────────
  interface GenerateReportBody {
    agent?: string;
    projectId: string;
    prompt: string;
    format: 'docx' | 'pptx' | 'pdf';
    dateFrom?: string;
    dateTo?: string;
  }

  type StoredTemplateAnalysis = {
    version?: number;
    sourceFormat?: 'docx' | 'pptx' | 'pdf';
    summary?: string;
    sectionHeadings?: string[];
    layoutHints?: string[];
    styleHints?: string[];
    palette?: string[];
    fonts?: string[];
    sampleExcerpt?: string;
    renderHints?: Record<string, unknown>;
  };

  function buildTemplatePromptSection(template: {
    filename?: string;
    extractedText?: string | null;
    analysis?: StoredTemplateAnalysis | null;
  } | null): string {
    if (!template) return '';

    const analysis = template.analysis;
    const lines: string[] = [];
    if (analysis?.summary) lines.push(`Summary: ${analysis.summary}`);
    if (analysis?.sectionHeadings?.length) {
      lines.push(`Section headings to mirror when the data supports them: ${analysis.sectionHeadings.slice(0, 10).join(' | ')}`);
    }
    if (analysis?.layoutHints?.length) {
      lines.push(`Layout cues: ${analysis.layoutHints.slice(0, 6).join(' ')}`);
    }
    if (analysis?.styleHints?.length) {
      lines.push(`Style cues: ${analysis.styleHints.slice(0, 6).join(' ')}`);
    }
    if (analysis?.palette?.length) {
      lines.push(`Palette hints: ${analysis.palette.slice(0, 6).join(', ')}`);
    }
    if (analysis?.fonts?.length) {
      lines.push(`Font hints: ${analysis.fonts.slice(0, 4).join(', ')}`);
    }
    if (analysis?.renderHints && Object.keys(analysis.renderHints).length > 0) {
      lines.push(`Render hints: ${JSON.stringify(analysis.renderHints)}`);
    }
    if (analysis?.sampleExcerpt) {
      lines.push(`Representative excerpt: ${analysis.sampleExcerpt.slice(0, 1000)}`);
    } else if (template.extractedText) {
      lines.push(`Representative excerpt: ${template.extractedText.slice(0, 1200)}`);
    }

    if (!lines.length) return '';

    return `\n\nREPORT TEMPLATE (match the uploaded template as closely as the data and output format allow. Preserve its section cadence, document density, heading behavior, and visual tone rather than defaulting to a generic report layout):\nTemplate file: ${template.filename ?? 'uploaded template'}\n${lines.join('\n')}`;
  }

  server.post<{ Body: GenerateReportBody }>('/ai/generate-report', async (request, reply) => {
    const { projectId, prompt, format, dateFrom, dateTo } = request.body;
    if (!projectId || !prompt) return reply.status(400).send({ error: 'projectId and prompt are required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const provider = (request.body.agent && request.body.agent !== 'auto')
      ? resolveProvider(request.body, 'claude-sonnet')
      : await resolveAutoProvider(request.headers.authorization, 'claude-sonnet');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    // Fetch the project's report template for the requested format (if any)
    const { data: templateEvents } = await supabase
      .from('events')
      .select('id, metadata')
      .eq('project_id', projectId)
      .eq('event_type', 'report_template')
      .filter('metadata->>template_type', 'eq', format ?? 'docx')
      .limit(1);
    const templateEvent = templateEvents?.[0] ?? null;
    const templateMeta = templateEvent?.metadata as {
      extracted_text?: string;
      content_preview?: string;
      document_id?: string | null;
      filename?: string;
      template_analysis?: StoredTemplateAnalysis | null;
    } | null;
    let templateDocumentText: string | null = null;
    if (templateEvent) {
      let templateDocumentQuery = supabase
        .from('project_documents')
        .select('extracted_text, content_preview')
        .eq('project_id', projectId)
        .limit(1);
      templateDocumentQuery = templateMeta?.document_id
        ? templateDocumentQuery.eq('id', templateMeta.document_id)
        : templateDocumentQuery.eq('event_id', templateEvent.id);
      const { data: templateDocument } = await templateDocumentQuery.maybeSingle();
      templateDocumentText = templateDocument?.extracted_text ?? templateDocument?.content_preview ?? null;
    }
    const templateSection = buildTemplatePromptSection(templateMeta ? {
      filename: templateMeta.filename,
      extractedText: templateMeta.extracted_text ?? templateDocumentText ?? templateMeta.content_preview ?? null,
      analysis: templateMeta.template_analysis ?? null,
    } : null);

    const ctx = await getCachedContext(projectId, userId);

    const dateFilter = dateFrom || dateTo
      ? `\nDate range filter: ${dateFrom ?? 'beginning'} → ${dateTo ?? 'today'}`
      : '';

    // Compute raw stats for chart data (returned alongside AI text)
    const statusCounts = { not_started: 0, in_progress: 0, in_review: 0, complete: 0 } as Record<string, number>;
    const categoryProgress: Record<string, number[]> = {};
    for (const g of ctx.goals) {
      statusCounts[g.status] = (statusCounts[g.status] ?? 0) + 1;
      const cat = g.category ?? 'Uncategorized';
      if (!categoryProgress[cat]) categoryProgress[cat] = [];
      categoryProgress[cat].push(g.progress);
    }
    const categoryAvg: Record<string, number> = {};
    for (const [cat, vals] of Object.entries(categoryProgress)) {
      categoryAvg[cat] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }

    // Trim context to stay within model input limits
    const trimmedEvents  = ctx.eventsText.slice(0, 4000);
    const trimmedGithub  = ctx.githubContext.slice(0, 2000);
    const trimmedGitlab  = ctx.gitlabContext.slice(0, 30_000);

    const contextBlock = `PROJECT: ${ctx.project?.name ?? 'Unknown'}${ctx.project?.description ? `\nDescription: ${ctx.project.description}` : ''}
${dateFilter}
USER REQUEST: ${prompt}

TASKS (${ctx.goals.length} total):
${ctx.goalsText}

TEAM (${ctx.members.length} members):
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${trimmedEvents}${trimmedGithub ? `\n\nGITHUB:\n${trimmedGithub}` : ''}${trimmedGitlab ? `\n\nGITLAB:\n${trimmedGitlab}` : ''}`;

    // ── Pass 1: generate metadata + section outlines — haiku is sufficient here ─
    // Pass 1 requires structured JSON with many fields — use the main provider for reliability
    const pass1Provider: AIProviderSelection = provider;

    let pass1: Record<string, unknown>;
    try {
      const now = new Date();
      const monthYear = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const r1 = await chat(pass1Provider, {
        system: `You are a senior project analyst and report planner. Return ONLY valid JSON — no markdown, no explanation.
Today's date is ${now.toISOString().slice(0, 10)} (${monthYear}).

Return an object with:
- "title": string (report title, max 70 chars — specific to this project and period)
- "subtitle": string — must use the CURRENT month and year: "${monthYear}" (e.g. "Project Status Report — ${monthYear}")
- "projectName": string
- "generatedAt": ISO date string (today: "${now.toISOString()}")
- "reportingPeriod": string (e.g. "Q2 2026" or "April 2026" based on today's date)
- "overallHealthScore": number 0-100 (weighted: completion rate 40%, on-time delivery 30%, recent activity 30%)
- "overallHealthLabel": string — one of "On Track", "At Risk", "Behind Schedule", "Ahead of Schedule"
- "executiveSummary": string (4-5 sentences covering: overall health score rationale, most significant accomplishments this period, top 2 risks or blockers, forward-looking outlook with specific milestones on the horizon)
- "keyMetrics": object with:
  - "tasksComplete": number
  - "tasksInProgress": number
  - "tasksNotStarted": number
  - "overallProgress": number (0-100, weighted average across all tasks)
  - "tasksOverdue": number (deadline passed, not complete)
  - "tasksDueSoon": number (deadline within 14 days, not complete)
  - "categoriesCount": number
- "accomplishments": array of 4-6 specific strings — concrete things completed or meaningfully advanced this period (cite task names, percentages, dates where possible)
- "blockers": array of 2-4 specific strings — tasks or areas that are stalled, overdue, or at risk, with specifics
- "upcomingMilestones": array of 3-5 strings — near-term deadlines and tasks to watch, with dates
- "recommendations": array of 3-5 actionable recommendation strings for the team
- "sectionTitles": array of 6-8 strings — exact section titles tailored to this project's data. Must include:
  * An executive/overview section
  * A task status & progress section (with figures)
  * A category breakdown section (with figures if multiple categories exist)
  * An accomplishments section
  * A risks & blockers section
  * An upcoming work / next steps section
  * Optionally: team contributions, code/commit activity (if git data exists), timeline analysis`,
        user: contextBlock + templateSection + '\n\nAnalyze the project data thoroughly and plan the full report structure as JSON.',
        maxTokens: 2500,
        jsonMode: true,
      }, userApiKey);
      const t1 = extractJson(r1.text);
      pass1 = JSON.parse(t1);
    } catch (err) {
      console.error('Pass 1 failed:', err);
      return reply.status(500).send({ error: `Failed to plan report structure: ${err instanceof Error ? err.message : String(err)}` });
    }

    const sectionTitles: string[] = Array.isArray(pass1.sectionTitles)
      ? (pass1.sectionTitles as string[])
      : ['Project Status Overview', 'Goal Progress', 'Team Contributions', 'Code & Commits', 'Risks & Recommendations'];

    // ── Pass 2: all sections in parallel — major speedup ───────────────────────
    const SECTION_SYSTEM = `You write one section of a comprehensive project report as JSON. Return ONLY valid JSON — no markdown, no explanation.
Today's date is ${new Date().toISOString().slice(0, 10)}.

Return an object with:
- "title": string (the section title)
- "body": string (3-5 sentences of deep, specific analysis — cite real task names, categories, percentages, team members, dates, and commit activity from the data. Do not write generic filler. Every sentence should contain a specific data point.)
- "bullets": array of 5-8 specific, data-driven bullet strings. Each bullet must reference real data (task names, numbers, percentages, dates). Mix positive accomplishments with gaps/risks where relevant.
- "table": optional — include when this section has structured data that benefits from tabular comparison. Object with "headers": string[] and "rows": string[][] (max 12 rows, max 5 columns). Rules: cell text max 35 chars, headers max 18 chars, abbreviate if needed.
- "figure": optional — include when real numeric data supports a visualization. Object with "type": "bar"|"pie"|"progress"|"timeline", "title": string, and "data": array of {label: string, value: number} objects. Only use actual numbers from the project data — never fabricate.
- "callout": optional — a single highlighted insight string (the most important takeaway for this section, max 100 chars). Use for executive/overview and risk sections.
- "subSections": optional array — for long sections, break into 2-3 sub-sections each with "heading": string and "text": string (2-3 sentences each).

QUALITY REQUIREMENTS:
- Every bullet must be specific and data-driven — under 130 characters, no vague filler like "the team is making progress".
- Body must be 3-5 sentences, not one long run-on. Start with the most important insight.
- Tables: consistent columns, no overflow, abbreviate long values.
- Figures: only real data, meaningful labels, no dummy values.
- For risk/blocker sections: be direct and specific about what is at risk and why.
- For accomplishments sections: cite specific completed tasks, progress jumps, and dates.`;

    // Build a compact pass1 summary to give each section writer context
    const pass1Summary = JSON.stringify({
      overallHealthScore: pass1.overallHealthScore,
      overallHealthLabel: pass1.overallHealthLabel,
      keyMetrics: pass1.keyMetrics,
      accomplishments: pass1.accomplishments,
      blockers: pass1.blockers,
      upcomingMilestones: pass1.upcomingMilestones,
      recommendations: pass1.recommendations,
    });

    const sectionResults = await Promise.all(
      sectionTitles.map(async (sectionTitle) => {
        try {
          const r2 = await chat(provider, {
            system: SECTION_SYSTEM,
            user: `${contextBlock}${templateSection}\n\nREPORT METADATA (use this context):\n${pass1Summary}\n\nWrite the section titled: "${sectionTitle}"`,
            maxTokens: 1800,
            jsonMode: true,
          }, userApiKey);
          const sec = JSON.parse(extractJson(r2.text));
          if (sec && typeof sec.title === 'string') return sec;
        } catch { /* fall through to placeholder */ }
        return { title: sectionTitle, body: 'Data unavailable for this section.', bullets: [] };
      })
    );
    const sections = sectionResults;

    const parsed: Record<string, unknown> = {
      ...pass1,
      sections,
      generatedAt: (pass1.generatedAt as string) || new Date().toISOString(),
      subtitle: (pass1.subtitle as string) || `Project Status Report — ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`,
      provider,
      template: templateMeta ? {
        id: templateEvent?.id ?? null,
        filename: templateMeta.filename ?? null,
        analysis: templateMeta.template_analysis ?? null,
      } : null,
    };

    // Attach raw data for client-side chart generation
    parsed.rawData = {
      goals: ctx.goals.map((g) => ({
        title:    g.title,
        status:   g.status,
        progress: g.progress,
        category: g.category ?? 'Uncategorized',
        deadline: g.deadline ?? null,
      })),
      statusCounts,
      categoryAvg,
      memberCount: ctx.members.length,
      totalGoals:  ctx.goals.length,
    };

    return parsed;
  });

  // ── Standup Generator: 2-week lookback ───────────────────────────────────────
  interface StandupBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: StandupBody }>('/ai/standup', async (request, reply) => {
    const { projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const provider = (request.body.agent && request.body.agent !== 'auto')
      ? resolveProvider(request.body, 'claude-haiku')
      : await resolveAutoProvider(request.headers.authorization, 'claude-haiku');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 14);
    const sinceISO = since.toISOString();
    const sinceDate = sinceISO.slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);

    const [{ data: project }, { data: goals }, { data: events }, gitlabRes] = await Promise.all([
      supabase.from('projects').select('name, description, github_repo, github_repos').eq('id', projectId).single(),
      supabase.from('goals').select('id, title, status, progress, deadline, category').eq('project_id', projectId),
      supabase.from('events').select('source, event_type, title, summary, occurred_at')
        .eq('project_id', projectId).gte('occurred_at', sinceISO)
        .order('occurred_at', { ascending: false }).limit(30),
      supabase.from('integrations').select('config').eq('project_id', projectId).eq('type', 'gitlab').maybeSingle(),
    ]);

    const githubRepos = getGitHubRepos(project);
    const gitlabCfg = gitlabRes.data?.config as GitLabIntegrationConfig | null;
    const gitlabRepos = getGitLabRepoPaths(gitlabCfg);
    const gitlabHost = getGitLabHost(gitlabCfg);
    const gitlabToken = getGitLabToken(gitlabCfg);

    const commitsByRepo: { source: 'github' | 'gitlab'; repo: string; commits: string[]; count: number }[] = [];

    for (const githubRepo of githubRepos) {
      const [owner, repo] = githubRepo.split('/');
      const token = process.env.GITHUB_TOKEN;
      const ghHeaders: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Odyssey-App' };
      if (token) ghHeaders.Authorization = `Bearer ${token}`;
      const msgs: string[] = [];
      try {
        for (let page = 1; page <= 2; page++) {
          const r = await fetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits?per_page=100&page=${page}&since=${sinceISO}`,
            { headers: ghHeaders }
          );
          if (!r.ok) break;
          const commits: { commit: { message: string } }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) msgs.push(c.commit.message.split('\n')[0].trim());
          if (commits.length < 100) break;
        }
      } catch { /* best-effort */ }
      if (msgs.length > 0) commitsByRepo.push({ source: 'github', repo: githubRepo, commits: msgs.slice(0, 50), count: msgs.length });
    }

    if (gitlabToken && gitlabHost) for (const repo of gitlabRepos) {
      const encoded = encodeURIComponent(repo);
      const msgs: string[] = [];
      try {
        for (let page = 1; page <= 2; page++) {
          const r = await fetch(
            `${gitlabHost}/api/v4/projects/${encoded}/repository/commits?per_page=100&page=${page}&since=${sinceISO}&order_by=created_at&sort=desc`,
            { headers: { 'PRIVATE-TOKEN': gitlabToken ?? '' } }
          );
          if (!r.ok) break;
          const commits: { title: string }[] = await r.json();
          if (!commits.length) break;
          for (const c of commits) msgs.push(c.title.trim());
          if (commits.length < 100) break;
        }
      } catch { /* best-effort */ }
      if (msgs.length > 0) commitsByRepo.push({ source: 'gitlab', repo, commits: msgs.slice(0, 50), count: msgs.length });
    }

    const totalCommits = commitsByRepo.reduce((sum, r) => sum + r.count, 0);

    const goalsText = (goals ?? []).map((g) =>
      `- [${g.status.toUpperCase()}] "${g.title}" — ${g.progress}%${g.deadline ? ` (due ${g.deadline})` : ''}`
    ).join('\n') || 'No tasks';

    const eventsText = (events ?? []).map((e) =>
      `[${e.occurred_at.slice(0, 10)}] ${e.source}: ${e.title ?? e.event_type}${e.summary ? ` — ${e.summary}` : ''}`
    ).join('\n') || 'No logged events in this period';

    const commitsText = commitsByRepo.map((r) => {
      const label = `${r.source === 'github' ? 'GitHub' : 'GitLab'}: ${r.repo.split('/').pop()}`;
      return `${label} (${r.count} commits):\n${r.commits.slice(0, 20).map((m) => `  - ${m}`).join('\n')}`;
    }).join('\n\n') || 'No commits in this period';

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's standup generator. Based on the project's commit activity, tasks, and logged events from the past 14 days, produce a concise team standup summary.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Return an object with:
- "highlights": string — one punchy sentence summarizing the sprint in plain English
- "accomplished": array of 3-6 strings — key things completed or meaningfully progressed in the past 2 weeks, grounded in actual commit messages and task progress
- "inProgress": array of 2-4 strings — work actively underway based on recent commits and active tasks
- "blockers": array of 0-3 strings — risks, stalled tasks, or potential blockers (return empty array if none apparent)

Be specific. Reference real task names, actual commit topics, and concrete percentages. When you mention repository files, prefer the most specific repo-qualified or path-qualified form you can infer, such as \`repo-name/src/module/file.ts\` or \`calibration/core/plot_generator.py\`, instead of shortening to ambiguous bare filenames. Avoid generic filler.`,
        user: `Project: ${project?.name ?? 'Unknown'}${project?.description ? `\nDescription: ${project.description}` : ''}
Period: ${sinceDate} → ${toDate} (14 days)
Total commits: ${totalCommits}

TASKS:
${goalsText}

COMMITS BY REPO:
${commitsText}

LOGGED EVENTS:
${eventsText}

Generate the standup summary.`,
        maxTokens: 800,
        jsonMode: true,
      }, userApiKey);

      const raw = extractJson(result.text);
      const parsed = JSON.parse(raw);

      const standupResult = {
        highlights: parsed.highlights ?? '',
        accomplished: parsed.accomplished ?? [],
        inProgress: parsed.inProgress ?? [],
        blockers: parsed.blockers ?? [],
        period: { from: sinceDate, to: toDate },
        commitSummary: commitsByRepo.map((r) => ({ source: r.source, repo: r.repo, count: r.count })),
        totalCommits,
        provider: result.provider,
      };

      // Persist (best-effort, non-blocking)
      supabase.from('standup_reports').upsert({
        project_id:    projectId,
        highlights:    standupResult.highlights,
        accomplished:  standupResult.accomplished,
        in_progress:   standupResult.inProgress,
        blockers:      standupResult.blockers,
        period:        standupResult.period,
        commit_summary: standupResult.commitSummary,
        total_commits: standupResult.totalCommits,
        provider:      standupResult.provider,
        generated_at:  new Date().toISOString(),
      }, { onConflict: 'project_id' }).then(({ error: e }) => {
        if (e) server.log.warn({ err: e }, 'Failed to persist standup');
      });

      return standupResult;
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to generate standup';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Intelligent Update: analyze everything and propose goal changes ────────
  interface IntelligentUpdateBody {
    agent?: string;
    projectId: string;
  }

  server.post<{ Body: IntelligentUpdateBody }>('/ai/intelligent-update', async (request, reply) => {
    const { projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const provider = (request.body.agent && request.body.agent !== 'auto')
      ? resolveProvider(request.body, 'claude-haiku')
      : await resolveAutoProvider(request.headers.authorization, 'claude-haiku');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);
    const ctx = await getCachedContext(projectId, userId);

    // ── Fetch project labels (categories + LOEs) ─────────────────────────────
    const { data: labelsData } = await supabase
      .from('project_labels')
      .select('type, name')
      .eq('project_id', projectId)
      .order('created_at');
    const projectCategories = (labelsData ?? []).filter((l: any) => l.type === 'category').map((l: any) => l.name as string);
    const projectLoes       = (labelsData ?? []).filter((l: any) => l.type === 'loe').map((l: any) => l.name as string);

    // ── Compute context signals to guide suggestion volume ───────────────────
    const goalCount       = ctx.goals.length;
    const repoContextLen  = (ctx.githubContext?.length ?? 0) + (ctx.gitlabContext?.length ?? 0);
    const docContextLen   = ctx.documentsContext?.length ?? 0;
    const hasRepos        = repoContextLen > 200;
    const hasDocs         = docContextLen > 200;
    const contextRich     = hasRepos || hasDocs;
    const contextVeryRich = (hasRepos && hasDocs) || repoContextLen > 10_000 || docContextLen > 5_000;

    // How many days since project was created
    const projectCreatedAt = ctx.project?.created_at ? new Date(ctx.project.created_at) : null;
    const projectAgeDays   = projectCreatedAt ? Math.floor((Date.now() - projectCreatedAt.getTime()) / 86_400_000) : 999;
    const projectIsNew     = projectAgeDays <= 14;

    // Determine suggestion volume range and creation bias
    let minSuggestions: number;
    let maxSuggestions: number;
    let creationBias: string;

    if (goalCount === 0) {
      // Brand new project — generate a full initial task list from available context
      minSuggestions = contextVeryRich ? 15 : contextRich ? 10 : 6;
      maxSuggestions = contextVeryRich ? 25 : contextRich ? 18 : 10;
      creationBias = 'STRONGLY BIAS toward create_goal — the project has no tasks yet. Build a complete task breakdown that covers everything visible in the repos, documents, and project description.';
    } else if (goalCount <= 5 && contextRich) {
      // Very few tasks but lots of context — the project is under-tracked
      minSuggestions = contextVeryRich ? 12 : 8;
      maxSuggestions = contextVeryRich ? 20 : 14;
      creationBias = 'STRONGLY BIAS toward create_goal — there are very few tasks relative to the available context. The project is clearly under-tracked. Add tasks to cover all significant work visible in repos/documents.';
    } else if (goalCount <= 10 && contextRich) {
      // Moderate tasks, rich context
      minSuggestions = 6;
      maxSuggestions = contextVeryRich ? 14 : 10;
      creationBias = 'MODERATELY BIAS toward create_goal — the task list appears incomplete relative to the scope visible in repos/documents. Fill in missing areas.';
    } else if (goalCount > 20 && !projectIsNew) {
      // Mature project with many tasks — focus on maintenance
      minSuggestions = 3;
      maxSuggestions = 8;
      creationBias = 'Focus primarily on update_goal, extend_deadline, contract_deadline, and delete_goal. Only create new tasks for clear gaps not covered by any existing task.';
    } else {
      // Default balanced range
      minSuggestions = 4;
      maxSuggestions = 10;
      creationBias = 'Balance create_goal with updates. Create tasks for any work visible in the context that has no corresponding task.';
    }

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's intelligent project advisor. Analyze ALL available project data — tasks, documents, commits, team activity — and produce a JSON list of specific, actionable suggestions to improve the project's task structure and deadlines.

Respond ONLY with valid JSON — no markdown, no code fences, no comments, no trailing commas, no explanation outside the JSON.

Return an object with one key:
- "suggestions": array of suggestion objects, each with:
  - "id": string (unique short id like "s1", "s2")
  - "type": "create_goal" | "update_goal" | "delete_goal" | "extend_deadline" | "contract_deadline"
  - "priority": "high" | "medium" | "low"
  - "title": string (short label shown in the UI, max 60 chars)
  - "reasoning": string (2-3 sentences explaining WHY this is suggested, referencing actual data)
  - "args": object matching the type:
    - create_goal: {title, deadline, category, loe, assignedTo?}
    - update_goal: {goalId, updates: {title?, status?, progress?, deadline?, category?, loe?, assigned_to?}}
    - delete_goal: {goalId, goalTitle}
    - extend_deadline: {goalId, goalTitle, currentDeadline, suggestedDeadline, reason}
    - contract_deadline: {goalId, goalTitle, currentDeadline, suggestedDeadline, reason}

REQUIRED FIELDS FOR create_goal — every create_goal suggestion MUST include ALL three of these or it will be rejected:
1. "deadline": ISO date string (YYYY-MM-DD). Estimate a realistic deadline based on task complexity and project context. Today is ${new Date().toISOString().split('T')[0]}.
2. "category": MUST be one of the project's defined categories listed below. Pick the best fit.
3. "loe": MUST be one of the project's defined lines of effort listed below. Pick the best fit.

PROJECT LABELS (you MUST use ONLY these exact values):
- Available categories: ${projectCategories.length > 0 ? projectCategories.map(c => `"${c}"`).join(', ') : '(none defined — omit category field)'}
- Available lines of effort: ${projectLoes.length > 0 ? projectLoes.map(l => `"${l}"`).join(', ') : '(none defined — omit loe field)'}

SUGGESTION VOLUME: Generate between ${minSuggestions} and ${maxSuggestions} suggestions. More is better when context is rich — do not artificially limit suggestions if there is genuine work to capture.

CREATION BIAS: ${creationBias}

CONTEXT SIGNALS (use to calibrate):
- Existing tasks: ${goalCount}
- Repo context available: ${hasRepos ? 'yes (' + Math.round(repoContextLen / 1000) + 'k chars)' : 'no'}
- Document context available: ${hasDocs ? 'yes (' + Math.round(docContextLen / 1000) + 'k chars)' : 'no'}
- Project age: ${projectAgeDays <= 1 ? 'brand new (today)' : projectAgeDays + ' days old'}

Be specific and reference actual task IDs, names, dates, file names, and commit messages from the context.`,
        user: `PROJECT: ${ctx.project?.name ?? 'Unknown'}

TASKS (${goalCount} total):
${ctx.goalsText || 'None — project has no tasks yet.'}

TEAM:
${ctx.membersText}

RECENT ACTIVITY & DOCUMENTS:
${ctx.eventsText.slice(0, 3000)}${ctx.githubContext ? `\n\nGITHUB:\n${ctx.githubContext.slice(0, 2000)}` : ''}${ctx.gitlabContext ? `\n\nGITLAB REPOS (commits + source code):\n${ctx.gitlabContext.slice(0, 60_000)}` : ''}

Analyze everything. ${goalCount === 0 ? 'Build a comprehensive initial task list from scratch based on all available context.' : 'Suggest specific improvements to the task structure, deadlines, and coverage.'} Remember: every create_goal MUST have deadline, category, and loe filled in.`,
        maxTokens: 4000,
        jsonMode: true,
      }, userApiKey);

      let raw = extractJson(result.text);
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Attempt graceful recovery if response was truncated mid-JSON
        const lastBrace = raw.lastIndexOf('}');
        if (lastBrace > 0) raw = raw.slice(0, lastBrace + 1);
        parsed = JSON.parse(raw);
      }

      // ── Validate + sanitise create_goal suggestions ───────────────────────
      const today = new Date().toISOString().split('T')[0];

      const suggestions: any[] = (parsed.suggestions ?? []).filter((s: any) => {
        if (s.type !== 'create_goal') return true; // non-create suggestions always pass through

        const args = s.args ?? {};

        // Must have a title
        if (!args.title?.trim()) return false;

        // Must have a deadline — if missing or invalid, drop the suggestion
        if (!args.deadline || typeof args.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(args.deadline)) return false;
        // Deadline must be in the future (or today)
        if (args.deadline < today) args.deadline = today;

        // Must have a category that exists in the project labels (if any defined)
        if (projectCategories.length > 0) {
          if (!args.category) return false;
          // Case-insensitive match — normalise to the canonical casing from project labels
          const match = projectCategories.find(c => c.toLowerCase() === args.category.toLowerCase());
          if (!match) return false;
          args.category = match; // normalise casing
        }

        // Must have a loe that exists in the project labels (if any defined)
        if (projectLoes.length > 0) {
          if (!args.loe) return false;
          const match = projectLoes.find(l => l.toLowerCase() === args.loe.toLowerCase());
          if (!match) return false;
          args.loe = match; // normalise casing
        }

        return true;
      });

      return { suggestions, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      const msg = err?.message ?? 'Failed to run intelligent update';
      if (msg.includes('credit') || msg.includes('billing')) return reply.status(402).send({ error: 'API key has no credits.' });
      return reply.status(500).send({ error: msg });
    }
  });

  // ── Load persisted standup report ─────────────────────────────────────────
  server.get<{ Params: { projectId: string } }>('/ai/standup/:projectId', async (request, reply) => {
    const { projectId } = request.params;
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;
    const { data, error } = await supabase
      .from('standup_reports')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error || !data) return reply.status(404).send({ error: 'No standup found' });
    return {
      highlights:    data.highlights,
      accomplished:  data.accomplished,
      inProgress:    data.in_progress,
      blockers:      data.blockers,
      period:        data.period,
      commitSummary: data.commit_summary,
      totalCommits:  data.total_commits,
      provider:      data.provider,
      generatedAt:   data.generated_at,
    };
  });

  // ── Per-task AI guidance ──────────────────────────────────────────────────
  interface TaskGuidanceBody {
    agent?: string;
    projectId: string;
    taskTitle: string;
    taskStatus: string;
    taskProgress: number;
    taskCategory?: string;
    taskLoe?: string;
  }

  server.post<{ Body: TaskGuidanceBody }>('/ai/task-guidance', async (request, reply) => {
    const { agent, projectId, taskTitle, taskStatus, taskProgress, taskCategory, taskLoe } = request.body;
    if (!projectId || !taskTitle) return reply.status(400).send({ error: 'projectId and taskTitle are required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;
    // Prefer haiku for lightweight guidance; for auto, pick based on what the user actually has
    const provider = (agent && agent !== 'auto')
      ? resolveProvider({ agent }, 'claude-haiku')
      : await resolveAutoProvider(request.headers.authorization, 'claude-haiku');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);
    const ctx = await getCachedContext(projectId, userId);

    const repoCtx = [
      ctx.githubContext ? `GITHUB COMMITS & README:\n${ctx.githubContext.slice(0, 3000)}` : '',
      ctx.gitlabContext ? `GITLAB CONTEXT:\n${ctx.gitlabContext.slice(0, 3000)}` : '',
    ].filter(Boolean).join('\n\n');

    try {
      const result = await chat(provider, {
        system: `You are a technical advisor giving specific, actionable guidance on how to make the most progress on a single project task. Be concrete. Reference repo files, commits, or related tasks where visible. No emojis. Use rich markdown: \`backticks\` for file names and identifiers, **bold** for key terms, bullet lists for steps (4-6 bullets max). When you reference repository files, prefer full repo-qualified paths such as \`repo-name/src/module/file.ts\` over ambiguous relative-only paths.`,
        user: `TASK: "${taskTitle}"
Status: ${taskStatus} (${taskProgress}% complete)
Category: ${taskCategory ?? 'unspecified'}
Line of Effort: ${taskLoe ?? 'unspecified'}

OTHER PROJECT TASKS:
${ctx.goalsText?.slice(0, 800) ?? 'none'}

${repoCtx}

Give me the 4-6 most impactful next steps to make concrete progress on this task right now.`,
        maxTokens: 500,
      }, userApiKey);
      return { guidance: result.text, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: err?.message ?? 'Failed to generate guidance' });
    }
  });

  // ── AI Search ────────────────────────────────────────────────────────────────
  interface AISearchBody { agent?: string; projectId: string; query: string; }

  server.post<{ Body: AISearchBody }>('/ai/search', async (request, reply) => {
    const { agent, projectId, query } = request.body;
    if (!projectId || !query) return reply.status(400).send({ error: 'projectId and query are required' });
    if (!(await ensureProjectAccess(reply, request.headers.authorization, projectId))) return;

    // Fetch goals + recent events
    const [goalsRes, eventsRes] = await Promise.all([
      supabase.from('goals').select('id,title,status,progress,category,loe,assignees,deadline').eq('project_id', projectId),
      supabase.from('events').select('id,title,summary,source,event_type,occurred_at').eq('project_id', projectId).order('occurred_at', { ascending: false }).limit(200),
    ]);

    const goals = goalsRes.data ?? [];
    const events = eventsRes.data ?? [];

    // Instant text match
    const q = query.toLowerCase();
    const textGoalIds = new Set(goals.filter((g: any) => g.title?.toLowerCase().includes(q)).map((g: any) => g.id));
    const textEventIds = new Set(events.filter((e: any) => e.title?.toLowerCase().includes(q) || e.summary?.toLowerCase().includes(q)).map((e: any) => e.id));

    const provider = resolveProvider({ agent }, 'claude-haiku');

    const goalsText = goals.map((g: any) =>
      `ID:${g.id} | "${g.title}" | ${g.status} | ${g.progress}% | category:${g.category ?? '-'} | assignees:${(g.assignees ?? []).join(',')} | deadline:${g.deadline ?? '-'}`
    ).join('\n');

    const eventsText = events.slice(0, 100).map((e: any) =>
      `ID:${e.id} | [${e.source}/${e.event_type}] ${e.title ?? ''} — ${e.summary?.slice(0, 120) ?? ''} | ${e.occurred_at?.slice(0, 10)}`
    ).join('\n');

    let aiGoalIds: string[] = [];
    let aiEventIds: string[] = [];
    let interpretation: string | null = null;

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's search engine. Given a natural language query about a project, identify which goals and events best match. Consider semantic meaning — the user might ask things like "tasks assigned to John", "what happened last week", or "at-risk items in Testing".
Respond ONLY with valid JSON: { "goalIds": ["id1",...], "eventIds": ["id1",...], "interpretation": "plain English explanation of what was searched for" }
Return up to 10 goalIds and 10 eventIds ordered by relevance.`,
        user: `QUERY: "${query}"

GOALS:
${goalsText || 'none'}

RECENT EVENTS:
${eventsText || 'none'}`,
        maxTokens: 600,
      });

      const parsed = JSON.parse(extractJson(result.text));
      aiGoalIds = Array.isArray(parsed.goalIds) ? parsed.goalIds : [];
      aiEventIds = Array.isArray(parsed.eventIds) ? parsed.eventIds : [];
      interpretation = parsed.interpretation ?? null;
    } catch {
      // fallback to text-only results
    }

    // Merge AI + text results, deduplicated
    const mergedGoals = [
      ...aiGoalIds.map((id: string) => ({ id, score: 'ai' as const })),
      ...[...textGoalIds].filter(id => !aiGoalIds.includes(id)).map(id => ({ id, score: 'text' as const })),
    ];
    const mergedEvents = [
      ...aiEventIds.map((id: string) => ({ id, score: 'ai' as const })),
      ...[...textEventIds].filter(id => !aiEventIds.includes(id)).map(id => ({ id, score: 'text' as const })),
    ];

    return { goals: mergedGoals, events: mergedEvents, interpretation, provider };
  });

  // ── Risk Assessment ───────────────────────────────────────────────────────────
  interface RiskAssessBody { agent?: string; projectId: string; }

  server.post<{ Body: RiskAssessBody }>('/ai/risk-assess', async (request, reply) => {
    const { agent, projectId } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const [goalsRes, depsRes] = await Promise.all([
      supabase.from('goals').select('id,title,status,progress,deadline,updated_at,assignees,category').eq('project_id', projectId),
      supabase.from('goal_dependencies').select('goal_id,depends_on_goal_id').eq('project_id', projectId),
    ]);

    const goals: any[] = goalsRes.data ?? [];
    const deps: any[] = depsRes.data ?? [];
    const now = new Date();

    const goalMap = new Map(goals.map(g => [g.id, g]));

    const goalsText = goals.map(g => {
      const deadline = g.deadline ? Math.round((new Date(g.deadline).getTime() - now.getTime()) / 86400000) : null;
      const stale = Math.round((now.getTime() - new Date(g.updated_at).getTime()) / 86400000);
      const myDeps = deps.filter(d => d.goal_id === g.id);
      const blockedBy = myDeps
        .map(d => goalMap.get(d.depends_on_goal_id))
        .filter((dep): dep is any => dep && dep.status !== 'complete')
        .map(dep => dep.title);

      return [
        `ID:${g.id} | "${g.title}" | ${g.status} | ${g.progress}%`,
        deadline !== null ? `deadline in ${deadline}d` : 'no deadline',
        `last updated ${stale}d ago`,
        blockedBy.length > 0 ? `blocked by: ${blockedBy.join(', ')}` : 'no blockers',
      ].join(' | ');
    }).join('\n');

    const provider = resolveProvider({ agent }, 'claude-sonnet');

    try {
      const result = await chat(provider, {
        system: `You are Odyssey's risk analyst. Evaluate each goal's risk based on: progress vs deadline proximity, staleness (days since last update), whether it depends on incomplete goals, and current status.
Risk levels: low(0-25), medium(26-50), high(51-75), critical(76-100).
Respond ONLY with a valid JSON array: [{ "goalId": "...", "score": 45, "level": "medium", "factors": ["3 days until deadline", "no updates in 10 days"] }]
Assess every goal listed.`,
        user: `PROJECT GOALS:\n${goalsText}`,
        maxTokens: 1500,
      });

      const assessments: { goalId: string; score: number; level: string; factors: string[] }[] = JSON.parse(extractJson(result.text));

      // Write risk scores back to goals (0-1 float)
      await Promise.all(
        assessments.map(a =>
          supabase.from('goals').update({ risk_score: a.score / 100 }).eq('id', a.goalId)
        )
      );

      // Log a single audit event
      await supabase.from('events').insert({
        project_id: projectId,
        source: 'ai',
        event_type: 'goal_risk_assessed',
        title: 'Risk assessment completed',
        summary: `${assessments.length} goals assessed`,
        occurred_at: new Date().toISOString(),
        created_by: userId,
      });

      return { assessments, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: 'Failed to assess risk' });
    }
  });

  // ── Meeting Notes → Suggested Tasks ───────────────────────────────────────
  interface MeetingNotesBody {
    agent?: string;
    projectId: string;
    fileContent: string;   // extracted text from the uploaded file
    fileName: string;
    existingTaskTitles?: string[];
  }

  server.post<{ Body: MeetingNotesBody }>('/ai/meeting-notes-tasks', async (request, reply) => {
    const { agent, projectId, fileContent, fileName, existingTaskTitles = [] } = request.body;
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });
    if (!fileContent?.trim()) return reply.status(400).send({ error: 'fileContent is required' });
    const userId = await ensureProjectAccess(reply, request.headers.authorization, projectId);
    if (!userId) return;

    const provider = agent && agent !== 'auto'
      ? resolveProvider(request.body, 'claude-sonnet')
      : await resolveAutoProvider(request.headers.authorization, 'claude-sonnet');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    const existingList = existingTaskTitles.length
      ? `\nExisting tasks (do not duplicate):\n${existingTaskTitles.map((t) => `- ${t}`).join('\n')}`
      : '';

    const systemPrompt = `You are a project manager assistant. Extract actionable tasks from meeting notes or documents.
Return a JSON array of task objects. Each object must have:
  - "title": string (concise action item, max 80 chars)
  - "description": string (brief context, 1-2 sentences, or empty string)
  - "category": string or null
  - "loe": string or null (level of effort: e.g. "Low", "Medium", "High", or null)
  - "deadline": string or null (ISO date if mentioned, otherwise null)
Only include concrete action items — skip administrative notes, context statements, or agenda items that are not tasks.
Do not duplicate existing tasks.${existingList}
Return only the JSON array, no other text.`;

    const userPrompt = `File: ${fileName}\n\n${fileContent.slice(0, 20_000)}`;

    try {
      const result = await chat(provider, { system: systemPrompt, user: userPrompt, maxTokens: 2000, jsonMode: true }, userApiKey);
      const parsed = JSON.parse(extractJson(result.text));
      const tasks = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
      return { tasks, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: err?.message ?? 'Failed to extract tasks from meeting notes' });
    }
  });

  server.post('/ai/dashboard-summary', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const provider = await resolveAutoProvider(request.headers.authorization, 'claude-haiku');
    const userApiKey = await getUserApiKey(request.headers.authorization, provider);

    const [{ data: memberships }, { data: ownedProjects }] = await Promise.all([
      supabase
        .from('project_members')
        .select('project_id')
        .eq('user_id', userId),
      supabase
        .from('projects')
        .select('id')
        .eq('owner_id', userId),
    ]);
    const projectIds = [...new Set([
      ...(memberships ?? []).map((membership: any) => membership.project_id as string),
      ...(ownedProjects ?? []).map((project: any) => project.id as string),
    ])];
    if (projectIds.length === 0) {
      return { summary: 'You are not a member of any projects yet.', provider };
    }

    // Fetch project names + assigned tasks + recent events
    const [projectsRes, tasksRes, eventsRes] = await Promise.all([
      supabase.from('projects').select('id, name, description').in('id', projectIds),
      supabase.from('goals')
        .select('title, status, progress, deadline, category, project_id')
        .in('project_id', projectIds)
        .or(`assigned_to.eq.${userId},assignees.cs.{${userId}}`)
        .neq('status', 'complete')
        .order('deadline', { ascending: true, nullsFirst: false })
        .limit(30),
      supabase.from('events')
        .select('title, event_type, occurred_at, project_id')
        .in('project_id', projectIds)
        .order('occurred_at', { ascending: false })
        .limit(20),
    ]);

    const projects = (projectsRes.data ?? []) as { id: string; name: string; description: string | null }[];
    const tasks = (tasksRes.data ?? []) as { title: string; status: string; progress: number; deadline: string | null; category: string | null; project_id: string }[];
    const events = (eventsRes.data ?? []) as { title: string; event_type: string; occurred_at: string; project_id: string }[];
    const projectNameMap = Object.fromEntries(projects.map((p) => [p.id, p.name]));

    const projectsContext = projects.map((p) =>
      `Project: ${p.name}${p.description ? ` — ${p.description}` : ''}`
    ).join('\n');

    const tasksContext = tasks.length
      ? tasks.map((t) => `[${projectNameMap[t.project_id] ?? 'Unknown'}] ${t.title} (${t.status}, ${t.progress}%${t.deadline ? `, due ${t.deadline}` : ''})`).join('\n')
      : 'No tasks assigned.';

    const eventsContext = events.length
      ? events.slice(0, 10).map((e) => `[${projectNameMap[e.project_id] ?? 'Unknown'}] ${e.title || e.event_type} (${e.occurred_at.slice(0, 10)})`).join('\n')
      : 'No recent activity.';

    const systemPrompt = `You are a project intelligence assistant. Write a concise, personal dashboard summary for a specific team member. 2-4 sentences. Focus on: what they should prioritize today, any upcoming deadlines, and notable recent activity. Be direct and actionable. No bullet points, no headers — just plain prose.`;

    const userPrompt = `My projects:\n${projectsContext}\n\nMy assigned tasks:\n${tasksContext}\n\nRecent activity:\n${eventsContext}`;

    try {
      const result = await chat(provider, { system: systemPrompt, user: userPrompt, maxTokens: 300 }, userApiKey);
      return { summary: result.text, provider: result.provider };
    } catch (err: any) {
      server.log.error(err);
      return reply.status(500).send({ error: err?.message ?? 'Failed to generate summary' });
    }
  });
}
