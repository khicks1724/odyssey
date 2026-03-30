import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const next = params.get('next') || '/';
    const connectGoogleAI = params.get('connect_google_ai') === '1';

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate('/login', { replace: true });
        return;
      }

      // If this was a Google AI OAuth flow, save the provider token as the
      // user's Google AI credential so the server can use it for Gemini.
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

      navigate(next, { replace: true });
    });
  }, [navigate, location.search]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted text-sm tracking-wider uppercase">Authenticating…</p>
    </div>
  );
}
