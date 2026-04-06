import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

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

      let session = (await supabase.auth.getSession()).data.session;

      // In OAuth code flow, make the code exchange explicit on the callback route.
      if (!session && hasCode && code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          navigate('/login', {
            replace: true,
            state: { authError: error.message },
          });
          return;
        }
        session = data.session;
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

      if (!cancelled) navigate(next, { replace: true });
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
