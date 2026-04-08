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

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Supabase env vars not set. Auth and data features will not work. ' +
    'Set VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or provide odyssey-config.js runtime values.'
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: {
      flowType: 'pkce',
    },
  },
);
