import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useNavigate, useLocation } from 'react-router-dom';
import { routerBasename, toAbsoluteAppUrl } from '../lib/base-path';
import { supabase } from '../lib/supabase';

let callbackCodeInFlight: string | null = null;
let callbackSessionPromise: Promise<Session | null> | null = null;

function isAppRoutePath(pathname: string) {
  if (routerBasename === '/') return pathname.startsWith('/');
  return pathname === routerBasename || pathname.startsWith(`${routerBasename}/`);
}

function resolvePostAuthRedirect(next: string) {
  if (typeof window === 'undefined') return next;

  try {
    const target = new URL(next, window.location.origin);

    if (target.origin !== window.location.origin) {
      return toAbsoluteAppUrl('/');
    }

    if (isAppRoutePath(target.pathname)) {
      return target.toString();
    }

    return toAbsoluteAppUrl(`${target.pathname}${target.search}${target.hash}`);
  } catch {
    const normalizedNext = next.startsWith('/') ? next : `/${next}`;
    return toAbsoluteAppUrl(normalizedNext);
  }
}

async function getCallbackSession(code: string | null, hasCode: boolean) {
  const existingSession = (await supabase.auth.getSession()).data.session;
  if (existingSession || !hasCode || !code) return existingSession;

  if (!callbackSessionPromise || callbackCodeInFlight !== code) {
    callbackCodeInFlight = code;
    callbackSessionPromise = supabase.auth
      .exchangeCodeForSession(code)
      .then(({ data, error }) => {
        if (error) throw error;
        return data.session;
      })
      .finally(() => {
        callbackSessionPromise = null;
      });
  }

  return callbackSessionPromise;
}

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;

    const finishAuth = async () => {
      const params = new URLSearchParams(location.search);
      const next = params.get('next') || '/';
      const connectGoogleAI = params.get('connect_google_ai') === '1';
      const hasCode = params.has('code');
      const code = params.get('code');
      const authError = params.get('error_description') || params.get('error');

      if (authError) {
        navigate('/login', {
          replace: true,
          state: { authError },
        });
        return;
      }

      let session: Session | null = null;

      try {
        session = await getCallbackSession(code, hasCode);
      } catch (error) {
        navigate('/login', {
          replace: true,
          state: { authError: error instanceof Error ? error.message : 'Authentication failed' },
        });
        return;
      }

      if (cancelled) return;

      if (!session) {
        navigate('/login', {
          replace: true,
          state: { authError: 'Authentication did not complete. Please try again.' },
        });
        return;
      }

      if (connectGoogleAI && session.provider_token) {
        try {
          const cred = JSON.stringify({
            access_token: session.provider_token,
            refresh_token: session.provider_refresh_token ?? null,
            connected_at: new Date().toISOString(),
          });
          await fetch('/api/user/ai-keys', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ provider: 'google', apiKey: cred, credentialType: 'oauth' }),
          });
        } catch {
          // Non-fatal — user can retry from settings
        }
      }

      if (!cancelled) {
        window.location.replace(resolvePostAuthRedirect(next));
      }
    };

    void finishAuth();

    return () => {
      cancelled = true;
    };
  }, [navigate, location.search]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted text-sm tracking-wider uppercase">Authenticating…</p>
    </div>
  );
}
