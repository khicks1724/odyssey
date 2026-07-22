import { useEffect, useState } from 'react';
import {
  clearGenAiMilBrowserKey,
  detectGenAiMilBrowserTransport,
  hasGenAiMilBrowserKey,
  isGenAiMilBrowserReady,
  performGenAiMilBrowserFetch,
  subscribeToGenAiMilBrowserReadiness,
} from '../lib/genai-mil-browser';
import { supabase } from '../lib/supabase';

interface RelayRequest {
  id: string;
  path: '/models' | '/chat/completions';
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeoutMs: number;
}

const WORKER_COUNT = 4;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

async function getAuthHeader(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : null;
}

async function postResult(requestId: string, payload: Record<string, unknown>, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt += 1) {
    const authorization = await getAuthHeader();
    if (!authorization) return;
    try {
      const response = await fetch(`/api/ai/genai-browser-relay/${requestId}/result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (response.ok || response.status === 404) return;
    } catch {
      if (signal.aborted) return;
    }
    await wait(500, signal);
  }
}

async function handleRelayRequest(request: RelayRequest, signal: AbortSignal): Promise<void> {
  try {
    const response = await performGenAiMilBrowserFetch({
      path: request.path,
      method: request.method,
      body: request.body,
      timeoutMs: request.timeoutMs,
      signal,
    });
    await postResult(request.id, {
      ok: true,
      status: response.status,
      body: response.body,
      contentType: response.contentType,
      retryAfter: response.retryAfter,
    }, signal);
  } catch (error) {
    await postResult(request.id, {
      ok: false,
      error: error instanceof Error ? error.message : 'Workstation-routed GenAI.mil request failed.',
    }, signal);
  }
}

async function runWorker(clientId: string, signal: AbortSignal): Promise<void> {
  while (!signal.aborted && isGenAiMilBrowserReady()) {
    const authorization = await getAuthHeader();
    if (!authorization) {
      await wait(1_000, signal);
      continue;
    }
    try {
      const response = await fetch('/api/ai/genai-browser-relay/poll', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        body: JSON.stringify({ clientId }),
        signal,
      });
      if (response.status === 204) continue;
      if (!response.ok) {
        await wait(response.status === 401 ? 1_500 : 750, signal);
        continue;
      }
      const payload = await response.json() as { request?: RelayRequest };
      if (payload.request) await handleRelayRequest(payload.request, signal);
    } catch {
      if (!signal.aborted) await wait(1_000, signal);
    }
  }
}

export default function GenAiMilBrowserRelay() {
  const [enabled, setEnabled] = useState(isGenAiMilBrowserReady);

  useEffect(() => subscribeToGenAiMilBrowserReadiness(setEnabled), []);

  useEffect(() => {
    if (hasGenAiMilBrowserKey()) void detectGenAiMilBrowserTransport();
  }, []);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') clearGenAiMilBrowserKey();
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const tabId = window.crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    for (let index = 0; index < WORKER_COUNT; index += 1) {
      void runWorker(`${tabId}:${index}`, controller.signal);
    }
    return () => controller.abort();
  }, [enabled]);

  return null;
}
