import { createClient } from '@supabase/supabase-js';

const runtimeConfig = typeof window !== 'undefined' ? window.__ODYSSEY_RUNTIME_CONFIG__ : undefined;

const configuredSupabaseUrl = runtimeConfig?.supabaseUrl ?? (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseUrl = typeof window !== 'undefined'
  ? configuredSupabaseUrl
    ? new URL(configuredSupabaseUrl, window.location.origin).toString()
    : `${window.location.origin}/supabase`
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
);
