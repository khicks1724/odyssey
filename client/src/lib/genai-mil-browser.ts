const GENAI_MIL_BASE_URL = 'https://api.genai.mil/v1';
const SESSION_STORAGE_KEY = 'odyssey-genai-mil-browser-key-v1';
const DEFAULT_MODEL = 'gemini-2.5-flash';

type KeyListener = (available: boolean) => void;
const keyListeners = new Set<KeyListener>();

function readSessionKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(SESSION_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

let sessionKey = readSessionKey();

export function isGenAiMilBrowserKey(value: string): boolean {
  const key = value.trim();
  return key.startsWith('STARK_') || key.startsWith('STARK-');
}

export function getGenAiMilBrowserKey(): string {
  return sessionKey;
}

export function hasGenAiMilBrowserKey(): boolean {
  return isGenAiMilBrowserKey(sessionKey);
}

export function setGenAiMilBrowserKey(value: string): void {
  const key = value.trim();
  if (!isGenAiMilBrowserKey(key)) throw new Error('Enter a valid STARK API key.');
  sessionKey = key;
  try {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, key);
  } catch {
    // Memory-only mode remains usable when session storage is unavailable.
  }
  for (const listener of keyListeners) listener(true);
}

export function clearGenAiMilBrowserKey(): void {
  sessionKey = '';
  try {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing else to clear.
  }
  for (const listener of keyListeners) listener(false);
}

export function subscribeToGenAiMilBrowserKey(listener: KeyListener): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanMessage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 600) : undefined;
}

function extractError(payload: unknown): { message?: string; unlockUrl?: string } {
  if (!isObject(payload)) return {};
  const error = payload.error;
  const errorObject = isObject(error) ? error : undefined;
  const message = cleanMessage(
    typeof error === 'string' ? error : errorObject?.message ?? payload.message ?? payload.detail,
  );
  const candidate = errorObject?.unlock_url ?? payload.unlock_url;
  let unlockUrl: string | undefined;
  if (typeof candidate === 'string') {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'https:') unlockUrl = parsed.toString();
    } catch {
      // Ignore malformed unlock URLs.
    }
  }
  return { message, unlockUrl };
}

export class GenAiMilBrowserApiError extends Error {
  readonly status: number;
  readonly code: 'browser_network' | 'network_access' | 'key_locked' | 'api_error' | 'invalid_response';
  readonly unlockUrl?: string;

  constructor(options: {
    message: string;
    status?: number;
    code: GenAiMilBrowserApiError['code'];
    unlockUrl?: string;
  }) {
    super(options.message);
    this.name = 'GenAiMilBrowserApiError';
    this.status = options.status ?? 0;
    this.code = options.code;
    this.unlockUrl = options.unlockUrl;
  }
}

export interface GenAiMilRawBrowserResponse {
  status: number;
  body: string;
  contentType?: string;
  retryAfter?: string;
}

export async function performGenAiMilBrowserFetch(options: {
  path: '/models' | '/chat/completions';
  method: 'GET' | 'POST';
  body?: JsonObject;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GenAiMilRawBrowserResponse> {
  const apiKey = getGenAiMilBrowserKey();
  if (!isGenAiMilBrowserKey(apiKey)) {
    throw new GenAiMilBrowserApiError({
      code: 'browser_network',
      message: 'No browser-session STARK key is available. Save or test the key in Settings → AI Providers first.',
    });
  }

  const timeoutController = new AbortController();
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 280_000, 280_000));
  const timeout = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const onParentAbort = () => timeoutController.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const response = await fetch(`${GENAI_MIL_BASE_URL}${options.path}`, {
      method: options.method,
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: timeoutController.signal,
    });
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? undefined,
      retryAfter: response.headers.get('retry-after') ?? undefined,
    };
  } catch {
    const timedOut = timeoutController.signal.aborted && !options.signal?.aborted;
    throw new GenAiMilBrowserApiError({
      code: 'browser_network',
      message: timedOut
        ? `The browser-direct GenAI.mil request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`
        : 'This browser could not call GenAI.mil directly. Confirm it is on an approved DoW network and that GenAI.mil allows CORS from the Odyssey site.',
    });
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

function parseBrowserResponse(response: GenAiMilRawBrowserResponse): unknown {
  let payload: unknown = null;
  try {
    payload = response.body ? JSON.parse(response.body) : null;
  } catch {
    payload = null;
  }
  if (response.status >= 200 && response.status < 300) {
    if (payload === null) {
      throw new GenAiMilBrowserApiError({
        status: response.status,
        code: 'invalid_response',
        message: 'GenAI.mil returned a non-JSON response to the browser.',
      });
    }
    return payload;
  }

  const { message, unlockUrl } = extractError(payload);
  if (unlockUrl || /key\s+(?:is\s+)?locked/i.test(message ?? '')) {
    throw new GenAiMilBrowserApiError({
      status: response.status,
      code: 'key_locked',
      unlockUrl,
      message: unlockUrl
        ? `STARK API key is locked. Unlock it at ${unlockUrl}, then retry.`
        : 'STARK API key is locked. Unlock it in GenAI.mil, then retry.',
    });
  }

  const looksLikeHtml = /^\s*</.test(response.body) || response.contentType?.includes('text/html');
  if (looksLikeHtml && /Unauthorized Access\s*-\s*GenAI\.mil|outside of DoW networks/i.test(response.body)) {
    throw new GenAiMilBrowserApiError({
      status: response.status,
      code: 'network_access',
      message: `GenAI.mil rejected this browser's network location. Connect this browser to an approved DoW network and retry. (HTTP ${response.status})`,
    });
  }

  throw new GenAiMilBrowserApiError({
    status: response.status,
    code: 'api_error',
    message: message
      ? `GenAI.mil rejected the browser request: ${message}`
      : `GenAI.mil browser request failed. (HTTP ${response.status})`,
  });
}

export async function testGenAiMilFromBrowser(apiKey: string): Promise<{
  models: string[];
  model: string;
}> {
  const previousKey = getGenAiMilBrowserKey();
  setGenAiMilBrowserKey(apiKey);
  try {
    const modelsPayload = parseBrowserResponse(await performGenAiMilBrowserFetch({
      path: '/models',
      method: 'GET',
      timeoutMs: 20_000,
    }));
    if (!isObject(modelsPayload) || !Array.isArray(modelsPayload.data)) {
      throw new GenAiMilBrowserApiError({
        code: 'invalid_response',
        message: 'GenAI.mil returned an invalid model list to the browser.',
      });
    }
    const models = [...new Set(modelsPayload.data
      .map((entry) => isObject(entry) && typeof entry.id === 'string' ? entry.id.trim() : '')
      .filter(Boolean))];
    if (models.length === 0) {
      throw new GenAiMilBrowserApiError({
        code: 'invalid_response',
        message: 'The STARK key is valid, but it has no available GenAI.mil models.',
      });
    }
    const model = models.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : models[0]!;
    const completionPayload = parseBrowserResponse(await performGenAiMilBrowserFetch({
      path: '/chat/completions',
      method: 'POST',
      timeoutMs: 30_000,
      body: {
        model,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        max_tokens: 16,
        temperature: 0,
        stream: false,
      },
    }));
    if (!isObject(completionPayload) || !Array.isArray(completionPayload.choices)) {
      throw new GenAiMilBrowserApiError({
        code: 'invalid_response',
        message: 'GenAI.mil returned an invalid browser test completion.',
      });
    }
    return { models, model };
  } catch (error) {
    if (isGenAiMilBrowserKey(previousKey)) setGenAiMilBrowserKey(previousKey);
    else clearGenAiMilBrowserKey();
    throw error;
  }
}
