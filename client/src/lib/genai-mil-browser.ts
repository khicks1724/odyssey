const GENAI_MIL_BASE_URL = 'https://api.genai.mil/v1';
const LOCAL_RELAY_BASE_URL = 'http://127.0.0.1:43127/v1';
const SESSION_STORAGE_KEY = 'odyssey-genai-mil-browser-key-v1';
const SESSION_VERIFIED_KEY = 'odyssey-genai-mil-browser-verified-v1';
const PAGE_MESSAGE_SOURCE = 'odyssey-genai-mil-page-v1';
const EXTENSION_MESSAGE_SOURCE = 'odyssey-genai-mil-extension-v1';

export type GenAiMilBrowserTransport = 'extension' | 'localhost' | 'direct';

type KeyListener = (available: boolean) => void;
type ReadinessListener = (ready: boolean) => void;
type TransportListener = (transport: GenAiMilBrowserTransport | null) => void;
const keyListeners = new Set<KeyListener>();
const readinessListeners = new Set<ReadinessListener>();
const transportListeners = new Set<TransportListener>();

function readSessionValue(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(key)?.trim() ?? '';
  } catch {
    return '';
  }
}

let sessionKey = readSessionValue(SESSION_STORAGE_KEY);
let sessionVerified = readSessionValue(SESSION_VERIFIED_KEY) === '1';
let activeTransport: GenAiMilBrowserTransport | null = null;

function writeSessionValue(key: string, value: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Memory-only mode remains usable when session storage is unavailable.
  }
}

function notifyReadiness(): void {
  const ready = isGenAiMilBrowserReady();
  for (const listener of readinessListeners) listener(ready);
}

function setActiveTransport(transport: GenAiMilBrowserTransport | null): void {
  if (activeTransport === transport) return;
  activeTransport = transport;
  for (const listener of transportListeners) listener(transport);
  notifyReadiness();
}

function setSessionVerified(verified: boolean): void {
  sessionVerified = verified;
  writeSessionValue(SESSION_VERIFIED_KEY, verified ? '1' : null);
  notifyReadiness();
}

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

export function isGenAiMilBrowserReady(): boolean {
  return hasGenAiMilBrowserKey() && sessionVerified && activeTransport !== null;
}

export function getGenAiMilBrowserTransport(): GenAiMilBrowserTransport | null {
  return activeTransport;
}

export function setGenAiMilBrowserKey(value: string): void {
  const key = value.trim();
  if (!isGenAiMilBrowserKey(key)) throw new Error('Enter a valid STARK API key.');
  const changed = key !== sessionKey;
  sessionKey = key;
  writeSessionValue(SESSION_STORAGE_KEY, key);
  if (changed) setSessionVerified(false);
  for (const listener of keyListeners) listener(true);
  notifyReadiness();
}

export function clearGenAiMilBrowserKey(): void {
  sessionKey = '';
  sessionVerified = false;
  writeSessionValue(SESSION_STORAGE_KEY, null);
  writeSessionValue(SESSION_VERIFIED_KEY, null);
  for (const listener of keyListeners) listener(false);
  notifyReadiness();
}

export function subscribeToGenAiMilBrowserKey(listener: KeyListener): () => void {
  keyListeners.add(listener);
  return () => keyListeners.delete(listener);
}

export function subscribeToGenAiMilBrowserReadiness(listener: ReadinessListener): () => void {
  readinessListeners.add(listener);
  return () => readinessListeners.delete(listener);
}

export function subscribeToGenAiMilBrowserTransport(listener: TransportListener): () => void {
  transportListeners.add(listener);
  return () => transportListeners.delete(listener);
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
  readonly code: 'browser_network' | 'bridge_required' | 'network_access' | 'key_locked' | 'api_error' | 'invalid_response';
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
  transport: GenAiMilBrowserTransport;
}

export interface GenAiMilBrowserFetchOptions {
  path: '/models' | '/chat/completions';
  method: 'GET' | 'POST';
  body?: JsonObject;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function requestId(): string {
  return window.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new GenAiMilBrowserApiError({
    code: 'browser_network',
    message: 'The GenAI.mil browser request was cancelled.',
  });
}

export function probeGenAiMilExtension(timeoutMs = 600): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const id = requestId();
  return new Promise((resolve) => {
    const finish = (available: boolean) => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      if (available) setActiveTransport('extension');
      else if (activeTransport === 'extension') setActiveTransport(null);
      resolve(available);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source === EXTENSION_MESSAGE_SOURCE && message?.type === 'pong' && message?.requestId === id) {
        finish(true);
      }
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: PAGE_MESSAGE_SOURCE, type: 'ping', requestId: id }, window.location.origin);
  });
}

export async function probeGenAiMilLocalRelay(timeoutMs = 1_200): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('http://127.0.0.1:43127/health', {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) {
      if (activeTransport === 'localhost') setActiveTransport(null);
      return false;
    }
    const payload = await response.json().catch(() => null) as { status?: unknown } | null;
    if (payload?.status !== 'ok') {
      if (activeTransport === 'localhost') setActiveTransport(null);
      return false;
    }
    setActiveTransport('localhost');
    return true;
  } catch {
    if (activeTransport === 'localhost') setActiveTransport(null);
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function detectGenAiMilBrowserTransport(): Promise<GenAiMilBrowserTransport | null> {
  if (await probeGenAiMilExtension()) return 'extension';
  if (await probeGenAiMilLocalRelay()) return 'localhost';
  setActiveTransport(null);
  return null;
}

async function tryExtensionFetch(
  options: GenAiMilBrowserFetchOptions,
  apiKey: string,
): Promise<GenAiMilRawBrowserResponse | null> {
  const id = requestId();
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 280_000, 280_000));
  return new Promise((resolve, reject) => {
    let accepted = false;
    let settled = false;
    let timer = 0;

    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (result: GenAiMilRawBrowserResponse | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const onAbort = () => fail('The GenAI.mil extension request was cancelled.');
    const onTimeout = () => {
      if (!accepted) {
        if (activeTransport === 'extension') setActiveTransport(null);
        finish(null);
      }
      else fail(`The GenAI.mil extension request timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data;
      if (message?.source !== EXTENSION_MESSAGE_SOURCE || message?.requestId !== id) return;
      if (message.type === 'accepted') {
        accepted = true;
        window.clearTimeout(timer);
        timer = window.setTimeout(onTimeout, timeoutMs + 5_000);
        return;
      }
      if (message.type !== 'result') return;
      if (message.ok !== true) {
        fail(cleanMessage(message.error) ?? 'The GenAI.mil extension request failed.');
        return;
      }
      const response = message.response;
      if (!response || !Number.isInteger(response.status) || typeof response.body !== 'string') {
        fail('The GenAI.mil extension returned an invalid response.');
        return;
      }
      setActiveTransport('extension');
      finish({
        status: response.status,
        body: response.body,
        contentType: typeof response.contentType === 'string' ? response.contentType : undefined,
        retryAfter: typeof response.retryAfter === 'string' ? response.retryAfter : undefined,
        transport: 'extension',
      });
    };

    if (options.signal?.aborted) {
      fail('The GenAI.mil extension request was cancelled.');
      return;
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('message', onMessage);
    timer = window.setTimeout(onTimeout, 750);
    window.postMessage({
      source: PAGE_MESSAGE_SOURCE,
      type: 'request',
      requestId: id,
      apiKey,
      request: {
        path: options.path,
        method: options.method,
        body: options.body,
        timeoutMs,
      },
    }, window.location.origin);
  });
}

async function fetchWithBrowser(
  baseUrl: string,
  transport: 'localhost' | 'direct',
  options: GenAiMilBrowserFetchOptions,
  apiKey: string,
): Promise<GenAiMilRawBrowserResponse> {
  const controller = new AbortController();
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs ?? 280_000, 280_000));
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });
  try {
    const response = await fetch(`${baseUrl}${options.path}`, {
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
      signal: controller.signal,
    });
    setActiveTransport(transport);
    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? undefined,
      retryAfter: response.headers.get('retry-after') ?? undefined,
      transport,
    };
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

export async function performGenAiMilBrowserFetch(
  options: GenAiMilBrowserFetchOptions,
): Promise<GenAiMilRawBrowserResponse> {
  const apiKey = getGenAiMilBrowserKey();
  if (!isGenAiMilBrowserKey(apiKey)) {
    throw new GenAiMilBrowserApiError({
      code: 'browser_network',
      message: 'No browser-session STARK key is available. Save or test the key in Settings → AI Providers first.',
    });
  }
  assertNotAborted(options.signal);

  const attemptErrors: string[] = [];
  try {
    const response = await tryExtensionFetch(options, apiKey);
    if (response) return response;
  } catch (error) {
    attemptErrors.push(error instanceof Error ? error.message : 'Extension request failed.');
  }
  assertNotAborted(options.signal);

  const localRelayAvailable = activeTransport === 'localhost' || await probeGenAiMilLocalRelay();
  if (localRelayAvailable) {
    try {
      return await fetchWithBrowser(LOCAL_RELAY_BASE_URL, 'localhost', options, apiKey);
    } catch (error) {
      attemptErrors.push(error instanceof Error ? error.message : 'Workstation relay request failed.');
    }
  }
  assertNotAborted(options.signal);

  try {
    return await fetchWithBrowser(GENAI_MIL_BASE_URL, 'direct', options, apiKey);
  } catch (error) {
    attemptErrors.push(error instanceof Error ? error.message : 'Direct browser request failed.');
  }

  const detail = attemptErrors.map(cleanMessage).filter(Boolean).join(' ');
  throw new GenAiMilBrowserApiError({
    code: 'bridge_required',
    message: `GenAI.mil blocks Odyssey's normal cross-origin browser request. Install the Odyssey GenAI.mil Chrome/Edge bridge (recommended), or run the workstation relay shown above, then reload and Test again.${detail ? ` (${detail.slice(0, 300)})` : ''}`,
  });
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
        message: 'GenAI.mil returned a non-JSON response to the workstation bridge.',
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
      message: `GenAI.mil rejected this workstation's network location through the ${response.transport} transport. Connect this device to an approved DoW network and retry. (HTTP ${response.status})`,
    });
  }

  throw new GenAiMilBrowserApiError({
    status: response.status,
    code: 'api_error',
    message: message
      ? `GenAI.mil rejected the workstation request: ${message}`
      : `GenAI.mil workstation request failed. (HTTP ${response.status})`,
  });
}

export async function testGenAiMilFromBrowser(apiKey: string, preferredModel?: string): Promise<{
  models: string[];
  model?: string;
  transport: GenAiMilBrowserTransport;
}> {
  const previousKey = getGenAiMilBrowserKey();
  const previousVerified = sessionVerified;
  setGenAiMilBrowserKey(apiKey);
  try {
    const modelsResponse = await performGenAiMilBrowserFetch({
      path: '/models',
      method: 'GET',
      timeoutMs: 20_000,
    });
    const modelsPayload = parseBrowserResponse(modelsResponse);
    if (!isObject(modelsPayload) || !Array.isArray(modelsPayload.data)) {
      throw new GenAiMilBrowserApiError({
        code: 'invalid_response',
        message: 'GenAI.mil returned an invalid model list to the workstation bridge.',
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
    const requestedModel = preferredModel?.trim();
    const model = requestedModel && models.includes(requestedModel) ? requestedModel : undefined;

    // Listing models validates the key and exposes the exact catalog without
    // silently spending a request on an arbitrary (and potentially legacy)
    // model. Only test a completion after the user has selected that model.
    if (!model) {
      setActiveTransport(modelsResponse.transport);
      setSessionVerified(true);
      return { models, transport: modelsResponse.transport };
    }

    const completionResponse = await performGenAiMilBrowserFetch({
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
    });
    const completionPayload = parseBrowserResponse(completionResponse);
    if (!isObject(completionPayload) || !Array.isArray(completionPayload.choices)) {
      throw new GenAiMilBrowserApiError({
        code: 'invalid_response',
        message: 'GenAI.mil returned an invalid workstation test completion.',
      });
    }
    setActiveTransport(completionResponse.transport);
    setSessionVerified(true);
    return { models, model, transport: completionResponse.transport };
  } catch (error) {
    if (isGenAiMilBrowserKey(previousKey)) {
      sessionKey = previousKey;
      writeSessionValue(SESSION_STORAGE_KEY, previousKey);
      setSessionVerified(previousVerified);
      for (const listener of keyListeners) listener(true);
    } else {
      clearGenAiMilBrowserKey();
    }
    throw error;
  }
}
