import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Provider, User, Session, UserIdentity } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { toAbsoluteAppUrl, withBasePath } from './base-path';
import { isLegacyUsername, legacyUsernameToInternalEmail, normalizeUsername, usernameToInternalEmail } from './username-auth';

export type OAuthProvider = Extract<Provider, 'github' | 'google' | 'azure'>;

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithUsernamePassword: (username: string, password: string) => Promise<void>;
  registerWithUsernamePassword: (input: { username: string; password: string; displayName?: string }) => Promise<{ username: string }>;
  signInWithGitHub: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  linkIdentity: (provider: OAuthProvider) => Promise<void>;
  unlinkIdentity: (identity: UserIdentity) => Promise<void>;
  refreshUser: () => Promise<void>;
  connectGoogleAI: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const PASSWORD_AUTH_TIMEOUT_MS = 15000;
const SIGN_OUT_TIMEOUT_MS = 5000;
const SUPABASE_AUTH_KEY_PATTERN = /^sb-.*-auth-token$/;

function clearSupabaseAuthStorage() {
  if (typeof window === 'undefined') return;

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (key && SUPABASE_AUTH_KEY_PATTERN.test(key)) {
      window.localStorage.removeItem(key);
    }
  }

  for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
    const key = window.sessionStorage.key(index);
    if (key && SUPABASE_AUTH_KEY_PATTERN.test(key)) {
      window.sessionStorage.removeItem(key);
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const getRedirectTo = () => {
    const next = new URLSearchParams(window.location.search).get('next');
    return toAbsoluteAppUrl(`/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  };

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: getRedirectTo() },
    });
  };

  const signInWithUsernamePassword = async (username: string, password: string) => {
    const primaryEmail = usernameToInternalEmail(username);
    const fallbackEmail = isLegacyUsername(username) ? legacyUsernameToInternalEmail(username) : null;

    const attemptSignIn = async (email: string) => withTimeout(
      supabase.auth.signInWithPassword({
        email,
        password,
      }),
      PASSWORD_AUTH_TIMEOUT_MS,
      'Sign-in timed out. Please try again.',
    );

    const primary = await attemptSignIn(primaryEmail);
    if (!primary.error) return;

    if (fallbackEmail && fallbackEmail !== primaryEmail) {
      const fallback = await attemptSignIn(fallbackEmail);
      if (!fallback.error) return;
    }

    throw new Error('Invalid username or password');
  };

  const registerWithUsernamePassword = async ({
    username,
    password,
    displayName,
  }: {
    username: string;
    password: string;
    displayName?: string;
  }) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: normalizeUsername(username),
        password,
        displayName,
      }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; success?: boolean } | null;

    if (!response.ok || !payload || !('success' in payload) || !payload.success) {
      throw new Error(payload?.error ?? 'Unable to create account');
    }

    return { username: normalizeUsername(username) };
  };

  const signInWithMicrosoft = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: getRedirectTo(),
        scopes: 'openid profile email offline_access',
        queryParams: {
          // No domain_hint — lets users choose work/school (AAD) or personal (MSA) accounts
          prompt: 'select_account',
        },
      },
    });
  };

  const linkIdentity = async (provider: OAuthProvider) => {
    const { data, error } = await supabase.auth.linkIdentity({
      provider,
      options: { redirectTo: getRedirectTo() },
    });
    if (error) throw error;
    // Supabase redirects automatically, but navigate manually as fallback
    if (data?.url) window.location.href = data.url;
  };

  const connectGoogleAI = async () => {
    // Request the Gemini scope so provider_token can call Google AI APIs.
    // offline access gives us a refresh_token for the callback to store.
    const redirectTo = toAbsoluteAppUrl(`/auth/callback?next=${encodeURIComponent(withBasePath('/settings'))}&connect_google_ai=1`);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes: 'https://www.googleapis.com/auth/generative-language',
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    });
  };

  const unlinkIdentity = async (identity: UserIdentity) => {
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) throw error;
    // Refresh user so identities list updates
    const { data } = await supabase.auth.getUser();
    if (data.user) setUser(data.user);
  };

  const refreshUser = async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) setUser(data.user);
  };

  const signOut = async () => {
    try {
      const { error } = await withTimeout(
        supabase.auth.signOut(),
        SIGN_OUT_TIMEOUT_MS,
        'Sign-out timed out. Clearing local session.',
      );
      if (error) throw error;
    } finally {
      clearSupabaseAuthStorage();
      setSession(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      signInWithUsernamePassword,
      registerWithUsernamePassword,
      signInWithGitHub,
      signInWithMicrosoft,
      linkIdentity,
      unlinkIdentity,
      refreshUser,
      connectGoogleAI,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
