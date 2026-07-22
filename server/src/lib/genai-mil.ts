/**
 * Minimal client for the STARK GenAI.mil OpenAI-compatible API.
 *
 * STARK API reference:
 *   GET  https://api.genai.mil/v1/models
 *   POST https://api.genai.mil/v1/chat/completions
 *   Authorization: Bearer <STARK API key>
 */

export const GENAI_MIL_BASE_URL = 'https://api.genai.mil/v1';
export const DEFAULT_GENAI_MIL_MODEL = 'gemini-2.5-flash';

export function isGenAiMilKey(value: string): boolean {
  const key = value.trim();
  return key.startsWith('STARK_') || key.startsWith('STARK-');
}

export type GenAiMilErrorCode =
  | 'network_access'
  | 'network_error'
  | 'key_locked'
  | 'unauthorized'
  | 'forbidden'
  | 'model_not_found'
  | 'rate_limited'
  | 'upstream_error'
  | 'invalid_response'
  | 'api_error';

export class GenAiMilApiError extends Error {
  readonly status: number;
  readonly code: GenAiMilErrorCode;
  readonly unlockUrl?: string;
  readonly retryAfterSeconds?: number;

  constructor(options: {
    message: string;
    status?: number;
    code: GenAiMilErrorCode;
    unlockUrl?: string;
    retryAfterSeconds?: number;
    cause?: unknown;
  }) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'GenAiMilApiError';
    this.status = options.status ?? 0;
    this.code = options.code;
    this.unlockUrl = options.unlockUrl;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export interface GenAiMilMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenAiMilTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface GenAiMilChatResult {
  text: string;
  model: string;
  usage?: GenAiMilTokenUsage;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanRemoteMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

function extractErrorEnvelope(payload: unknown): {
  message?: string;
  type?: string;
  unlockUrl?: string;
} {
  if (!isObject(payload)) return {};

  const error = payload.error;
  const errorObject = isObject(error) ? error : undefined;
  const message = cleanRemoteMessage(
    typeof error === 'string'
      ? error
      : errorObject?.message ?? payload.message ?? payload.detail,
  );
  const type = cleanRemoteMessage(errorObject?.type ?? payload.type);
  const candidateUnlockUrl = errorObject?.unlock_url ?? payload.unlock_url;

  let unlockUrl: string | undefined;
  if (typeof candidateUnlockUrl === 'string') {
    try {
      const parsed = new URL(candidateUnlockUrl);
      // STARK intentionally treats unlock_url as an opaque URL; its documentation
      // does not guarantee a host, so only require encrypted transport.
      if (parsed.protocol === 'https:') {
        unlockUrl = parsed.toString();
      }
    } catch {
      // Ignore malformed unlock links.
    }
  }

  return { message, type, unlockUrl };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function parseBodyRetryAfter(payload: unknown): number | undefined {
  if (!isObject(payload)) return undefined;
  const error = isObject(payload.error) ? payload.error : undefined;
  const value = error?.retry_after_seconds ?? payload.retry_after_seconds;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

function buildApiError(response: Response, rawBody: string, payload: unknown): GenAiMilApiError {
  const { message: remoteMessage, type, unlockUrl } = extractErrorEnvelope(payload);
  const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after')) ?? parseBodyRetryAfter(payload);

  if (unlockUrl || /key\s+(?:is\s+)?locked/i.test(remoteMessage ?? '') || type === 'key_locked') {
    return new GenAiMilApiError({
      status: response.status,
      code: 'key_locked',
      unlockUrl,
      message: unlockUrl
        ? `STARK API key is locked. Unlock it at ${unlockUrl}, then retry.`
        : 'STARK API key is locked. Unlock it in the GenAI.mil API Keys page, then retry.',
    });
  }

  const looksLikeHtml = /^\s*</.test(rawBody) || response.headers.get('content-type')?.includes('text/html');
  if (looksLikeHtml) {
    const pageText = htmlToText(rawBody);
    if (/unauthorized access\s*-\s*genai\.mil/i.test(pageText) || /outside of DoW networks/i.test(pageText)) {
      return new GenAiMilApiError({
        status: response.status,
        code: 'network_access',
        message: `GenAI.mil rejected the Odyssey server's network location. Your browser may be on a DoW network, but STARK evaluates the network used by the Odyssey server. Route the server through an approved DoW/VPN egress, then retry. (HTTP ${response.status})`,
      });
    }
    return new GenAiMilApiError({
      status: response.status,
      code: 'upstream_error',
      message: `GenAI.mil returned an unexpected HTML gateway response. Try again, then verify the Odyssey server's DoW/VPN egress if it persists. (HTTP ${response.status})`,
    });
  }

  if (response.status === 401) {
    return new GenAiMilApiError({
      status: response.status,
      code: 'unauthorized',
      message: remoteMessage
        ? `STARK rejected the API key: ${remoteMessage}`
        : 'STARK rejected the API key. Confirm that the saved STARK key is active and complete.',
    });
  }
  if (response.status === 403) {
    return new GenAiMilApiError({
      status: response.status,
      code: 'forbidden',
      message: remoteMessage
        ? `STARK denied access: ${remoteMessage}`
        : 'STARK authenticated the request but denied access to this resource or model.',
    });
  }
  if (response.status === 404) {
    return new GenAiMilApiError({
      status: response.status,
      code: 'model_not_found',
      message: remoteMessage
        ? `STARK could not find the requested model: ${remoteMessage}`
        : 'The requested STARK model is not available to this key.',
    });
  }
  if (response.status === 429) {
    const retryText = retryAfterSeconds === undefined ? '' : ` Retry after ${retryAfterSeconds} seconds.`;
    return new GenAiMilApiError({
      status: response.status,
      code: 'rate_limited',
      retryAfterSeconds,
      message: `STARK rate limit exceeded.${retryText}${remoteMessage ? ` ${remoteMessage}` : ''}`.trim(),
    });
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return new GenAiMilApiError({
      status: response.status,
      code: 'upstream_error',
      message: remoteMessage
        ? `GenAI.mil upstream service failed: ${remoteMessage}`
        : `GenAI.mil upstream service is unavailable. Try again shortly. (HTTP ${response.status})`,
    });
  }

  return new GenAiMilApiError({
    status: response.status,
    code: 'api_error',
    message: remoteMessage
      ? `GenAI.mil API ${response.status}: ${remoteMessage}`
      : `GenAI.mil API request failed. (HTTP ${response.status})`,
  });
}

async function starkRequest(path: string, options: {
  apiKey: string;
  method?: 'GET' | 'POST';
  body?: JsonObject;
  timeoutMs?: number;
}): Promise<unknown> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new GenAiMilApiError({
      status: 401,
      code: 'unauthorized',
      message: 'No STARK API key was provided.',
    });
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 280_000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  let rawBody: string;
  try {
    response = await fetch(`${GENAI_MIL_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    rawBody = await response.text();
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new GenAiMilApiError({
      code: 'network_error',
      message: timedOut
        ? `The GenAI.mil request timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Verify the Odyssey server's DoW/VPN route and try again.`
        : `The Odyssey server could not connect to GenAI.mil. Verify its DNS and approved DoW/VPN egress, then retry.`,
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) throw buildApiError(response, rawBody, payload);
  if (payload === null) {
    throw new GenAiMilApiError({
      status: response.status,
      code: 'invalid_response',
      message: 'GenAI.mil returned a non-JSON response to a successful API request.',
    });
  }
  return payload;
}

export async function listGenAiMilModels(apiKey: string, timeoutMs = 20_000): Promise<string[]> {
  const payload = await starkRequest('/models', { apiKey, timeoutMs });
  if (!isObject(payload) || !Array.isArray(payload.data)) {
    throw new GenAiMilApiError({
      code: 'invalid_response',
      message: 'GenAI.mil returned an invalid model-list response.',
    });
  }

  const modelIds = payload.data
    .map((item) => isObject(item) && typeof item.id === 'string' ? item.id.trim() : '')
    .filter(Boolean);
  const uniqueModelIds = [...new Set(modelIds)];
  if (uniqueModelIds.length === 0) {
    throw new GenAiMilApiError({
      code: 'invalid_response',
      message: 'The STARK key is valid, but no GenAI.mil models are available to it.',
    });
  }
  return uniqueModelIds;
}

export function selectGenAiMilModel(models: string[], preferredModel?: string): string {
  const preferred = preferredModel?.trim();
  if (preferred && models.includes(preferred)) return preferred;
  if (models.includes(DEFAULT_GENAI_MIL_MODEL)) return DEFAULT_GENAI_MIL_MODEL;
  return models[0] ?? preferred ?? DEFAULT_GENAI_MIL_MODEL;
}

export async function createGenAiMilChatCompletion(options: {
  apiKey: string;
  model: string;
  messages: GenAiMilMessage[];
  maxTokens: number;
  temperature: number;
  timeoutMs?: number;
}): Promise<GenAiMilChatResult> {
  const model = options.model.trim() || DEFAULT_GENAI_MIL_MODEL;
  const payload = await starkRequest('/chat/completions', {
    apiKey: options.apiKey,
    method: 'POST',
    timeoutMs: options.timeoutMs,
    body: {
      model,
      messages: options.messages,
      max_tokens: Math.max(1, Math.trunc(options.maxTokens)),
      temperature: Math.min(2, Math.max(0, options.temperature)),
      stream: false,
    },
  });

  if (!isObject(payload) || !Array.isArray(payload.choices)) {
    throw new GenAiMilApiError({
      code: 'invalid_response',
      message: 'GenAI.mil returned an invalid chat-completion response.',
    });
  }
  const firstChoice = payload.choices[0];
  const message = isObject(firstChoice) && isObject(firstChoice.message) ? firstChoice.message : undefined;
  const text = typeof message?.content === 'string' ? message.content : '';
  if (!text) {
    throw new GenAiMilApiError({
      code: 'invalid_response',
      message: 'GenAI.mil returned a chat completion without message content.',
    });
  }

  const usageObject = isObject(payload.usage) ? payload.usage : undefined;
  const promptTokens = Number(usageObject?.prompt_tokens ?? 0);
  const completionTokens = Number(usageObject?.completion_tokens ?? 0);
  const totalTokens = Number(usageObject?.total_tokens ?? promptTokens + completionTokens);
  const usage = Number.isFinite(totalTokens) && totalTokens > 0
    ? {
        promptTokens: Number.isFinite(promptTokens) ? promptTokens : 0,
        completionTokens: Number.isFinite(completionTokens) ? completionTokens : 0,
        totalTokens,
      }
    : undefined;

  return {
    text,
    model: typeof payload.model === 'string' && payload.model.trim() ? payload.model : model,
    usage,
  };
}
