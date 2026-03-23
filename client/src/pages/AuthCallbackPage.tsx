import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const next = new URLSearchParams(location.search).get('next') || '/';
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate(next, { replace: true });
      } else {
        navigate('/login', { replace: true });
      }
    });
  }, [navigate, location.search]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-muted text-sm tracking-wider uppercase">Authenticating…</p>
    </div>
  );
}
