import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User, Session, UserIdentity } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type OAuthProvider = 'github' | 'google' | 'azure';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithGitHub: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  linkIdentity: (provider: OAuthProvider) => Promise<void>;
  unlinkIdentity: (identity: UserIdentity) => Promise<void>;
  refreshUser: () => Promise<void>;
  connectGoogleAI: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

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
    return `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  };

  const signInWithGitHub = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo: getRedirectTo() },
    });
  };

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getRedirectTo() },
    });
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
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent('/settings')}&connect_google_ai=1`;
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
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signInWithGitHub, signInWithGoogle, signInWithMicrosoft, linkIdentity, unlinkIdentity, refreshUser, connectGoogleAI, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
