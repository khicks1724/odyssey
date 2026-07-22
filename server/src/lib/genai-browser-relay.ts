import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type GenAiBrowserRelayMethod = 'GET' | 'POST';

export interface GenAiBrowserRelayRequest {
  id: string;
  path: '/models' | '/chat/completions';
  method: GenAiBrowserRelayMethod;
  body?: Record<string, unknown>;
  timeoutMs: number;
}

export interface GenAiBrowserRelayResponse {
  status: number;
  body: string;
  contentType?: string;
  retryAfter?: string;
}

type RelayCompletion =
  | { ok: true; response: GenAiBrowserRelayResponse }
  | { ok: false; error: string };

interface PendingRelayRequest {
  userId: string;
  resolve: (response: GenAiBrowserRelayResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface PollWaiter {
  clientId: string;
  resolve: (request: GenAiBrowserRelayRequest | null) => void;
  timeout: NodeJS.Timeout;
  cleanup?: () => void;
}

interface UserRelayState {
  queue: GenAiBrowserRelayRequest[];
  waiters: PollWaiter[];
  clients: Map<string, number>;
}

const POLL_TIMEOUT_MS = 20_000;
const CLIENT_ACTIVE_TTL_MS = 45_000;
const MAX_QUEUE_DEPTH = 24;
const relayContext = new AsyncLocalStorage<{ userId: string }>();
const states = new Map<string, UserRelayState>();
const pending = new Map<string, PendingRelayRequest>();

export class GenAiBrowserRelayError extends Error {
  readonly code: 'browser_relay_unavailable' | 'browser_request_failed' | 'browser_request_timeout';

  constructor(
    code: GenAiBrowserRelayError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'GenAiBrowserRelayError';
    this.code = code;
  }
}

function getState(userId: string): UserRelayState {
  const existing = states.get(userId);
  if (existing) return existing;
  const created: UserRelayState = {
    queue: [],
    waiters: [],
    clients: new Map(),
  };
  states.set(userId, created);
  return created;
}

function pruneInactiveClients(state: UserRelayState): void {
  const cutoff = Date.now() - CLIENT_ACTIVE_TTL_MS;
  for (const [clientId, lastSeen] of state.clients) {
    if (lastSeen < cutoff) state.clients.delete(clientId);
  }
}

function removeWaiter(state: UserRelayState, waiter: PollWaiter): void {
  const index = state.waiters.indexOf(waiter);
  if (index >= 0) state.waiters.splice(index, 1);
  clearTimeout(waiter.timeout);
  waiter.cleanup?.();
}

function deliverNext(state: UserRelayState): void {
  while (state.queue.length > 0 && state.waiters.length > 0) {
    const request = state.queue.shift();
    const waiter = state.waiters.shift();
    if (!request || !waiter) return;
    clearTimeout(waiter.timeout);
    waiter.cleanup?.();
    state.clients.set(waiter.clientId, Date.now());
    waiter.resolve(request);
  }
}

export function hasActiveGenAiBrowserRelay(userId: string): boolean {
  const state = states.get(userId);
  if (!state) return false;
  pruneInactiveClients(state);
  return state.clients.size > 0 || state.waiters.length > 0;
}

export function withGenAiBrowserRelay<T>(userId: string, task: () => Promise<T>): Promise<T> {
  return relayContext.run({ userId }, task);
}

export function getGenAiBrowserRelayUserId(): string | undefined {
  return relayContext.getStore()?.userId;
}

export async function pollGenAiBrowserRelay(
  userId: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<GenAiBrowserRelayRequest | null> {
  const state = getState(userId);
  state.clients.set(clientId, Date.now());
  const queued = state.queue.shift();
  if (queued) return queued;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (request: GenAiBrowserRelayRequest | null) => {
      if (settled) return;
      settled = true;
      removeWaiter(state, waiter);
      state.clients.set(clientId, Date.now());
      resolve(request);
    };
    const onAbort = () => finish(null);
    const waiter: PollWaiter = {
      clientId,
      resolve: finish,
      timeout: setTimeout(() => finish(null), POLL_TIMEOUT_MS),
      cleanup: signal ? () => signal.removeEventListener('abort', onAbort) : undefined,
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    state.waiters.push(waiter);
    deliverNext(state);
  });
}

export async function requestGenAiFromBrowser(
  userId: string,
  input: Omit<GenAiBrowserRelayRequest, 'id'>,
): Promise<GenAiBrowserRelayResponse> {
  const state = getState(userId);
  pruneInactiveClients(state);
  if (!hasActiveGenAiBrowserRelay(userId)) {
    throw new GenAiBrowserRelayError(
      'browser_relay_unavailable',
      'GenAI.mil browser-direct mode is not active. Open Settings → AI Providers and save or test your STARK key in this browser tab, then retry.',
    );
  }
  if (state.queue.length >= MAX_QUEUE_DEPTH) {
    throw new GenAiBrowserRelayError(
      'browser_request_failed',
      'The GenAI.mil browser-direct queue is full. Wait for the current requests to finish, then retry.',
    );
  }

  const id = randomUUID();
  const request: GenAiBrowserRelayRequest = { ...input, id };
  const timeoutMs = Math.max(5_000, Math.min(input.timeoutMs + 10_000, 300_000));

  const responsePromise = new Promise<GenAiBrowserRelayResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new GenAiBrowserRelayError(
        'browser_request_timeout',
        `The GenAI.mil request through this browser timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`,
      ));
    }, timeoutMs);
    pending.set(id, { userId, resolve, reject, timeout });
  });

  state.queue.push(request);
  deliverNext(state);
  return responsePromise;
}

export function completeGenAiBrowserRelay(
  userId: string,
  requestId: string,
  completion: RelayCompletion,
): boolean {
  const target = pending.get(requestId);
  if (!target || target.userId !== userId) return false;
  pending.delete(requestId);
  clearTimeout(target.timeout);

  const state = states.get(userId);
  if (state) {
    for (const clientId of state.clients.keys()) state.clients.set(clientId, Date.now());
  }

  if (completion.ok) {
    target.resolve(completion.response);
  } else {
    target.reject(new GenAiBrowserRelayError(
      'browser_request_failed',
      completion.error,
    ));
  }
  return true;
}
