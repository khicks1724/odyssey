import { createClient } from '@supabase/supabase-js';
import { appBasePath, toAbsoluteAppUrl } from './base-path';

const runtimeConfig = typeof window !== 'undefined' ? window.__ODYSSEY_RUNTIME_CONFIG__ : undefined;

const configuredSupabaseUrl = runtimeConfig?.supabaseUrl ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const resolveSupabaseUrl = (value: string): string => {
  if (typeof window === 'undefined') return value;
  if (/^[a-z]+:\/\//i.test(value) || value.startsWith('//')) return value;

  if (value.startsWith('/')) {
    const relativeToApp = value.startsWith(appBasePath) ? value : toAbsoluteAppUrl(value);
    return new URL(relativeToApp, window.location.origin).toString();
  }

  return new URL(value, toAbsoluteAppUrl('/')).toString();
};

const supabaseUrl = typeof window !== 'undefined'
  ? configuredSupabaseUrl
    ? resolveSupabaseUrl(configuredSupabaseUrl)
    : toAbsoluteAppUrl('/supabase')
  : configuredSupabaseUrl;
const supabaseAnonKey = runtimeConfig?.supabaseAnonKey ?? (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

function isProxyRealtimeCapable(url: string | undefined): boolean {
  if (typeof window === 'undefined' || !url) return true;

  try {
    const resolvedUrl = new URL(url);
    const normalizedPath = resolvedUrl.pathname.replace(/\/+$/, '');
    // appBasePath keeps a trailing slash (e.g. "/odyssey/"), so strip it before
    // appending "/supabase" — otherwise we'd compare against "/odyssey//supabase"
    // and the match would always fail, leaving realtime enabled over a proxy that
    // cannot carry the websocket.
    const appBasePrefix = appBasePath === '/' ? '' : appBasePath.replace(/\/+$/, '');
    const appScopedSupabasePath = `${appBasePrefix}/supabase`;

    return !(resolvedUrl.origin === window.location.origin && normalizedPath === appScopedSupabasePath);
  } catch {
    return true;
  }
}

export const supabaseRealtimeEnabled = runtimeConfig?.realtimeEnabled ?? isProxyRealtimeCapable(supabaseUrl);

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars not set. Auth and data features will not work. ' +
    'Set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or provide odyssey-config.js runtime values.'
  );
}

// Hard-bound every Supabase request. Without a timeout, a single stalled request
// (notably a token refresh going through the subpath proxy) hangs forever, which
// holds the gotrue auth Web Lock and blocks every later getSession()/query —
// surfacing as the app freezing on a page until the user manually refreshes.
const SUPABASE_FETCH_TIMEOUT_MS = 20000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Respect a caller-provided signal while also enforcing our own timeout.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);

  const callerSignal = init?.signal;
  const handleCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', handleCallerAbort, { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', handleCallerAbort);
  });
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: {
      flowType: 'pkce',
    },
    global: {
      fetch: fetchWithTimeout,
    },
  },
);
