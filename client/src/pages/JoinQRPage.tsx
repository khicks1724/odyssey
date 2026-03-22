/**
 * JoinQRPage — handles /join/qr/:token
 *
 * Authenticated users are redirected here after scanning a QR code.
 * Unauthenticated users are bounced to /login with a `next` param so
 * they come back here after signing in via GitHub.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle, QrCode, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

type State =
  | { status: 'loading' }
  | { status: 'joined';   projectId: string; projectName: string }
  | { status: 'requested'; projectId: string; projectName: string }
  | { status: 'already';   projectId: string; projectName: string }
  | { status: 'error';    message: string }
  | { status: 'auth' };   // not signed in

export default function JoinQRPage() {
  const { token }     = useParams<{ token: string }>();
  const navigate      = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setState({ status: 'auth' });
      return;
    }
    if (!token) {
      setState({ status: 'error', message: 'Invalid invite link — no token found.' });
      return;
    }

    (async () => {
      try {
        const { data, error } = await supabase.rpc('redeem_qr_token', { p_token: token });
        if (error) throw error;
        const res = data as { result?: string; error?: string; project_id?: string; project_name?: string };

        if (res.error) {
          setState({ status: 'error', message: res.error as string });
        } else if (res.result === 'joined') {
          setState({ status: 'joined', projectId: res.project_id!, projectName: res.project_name! });
          setTimeout(() => navigate(`/projects/${res.project_id}`), 2000);
        } else if (res.result === 'already_member') {
          setState({ status: 'already', projectId: res.project_id!, projectName: res.project_name! });
        } else if (res.result === 'request_sent') {
          setState({ status: 'requested', projectId: res.project_id!, projectName: res.project_name! });
        } else {
          setState({ status: 'error', message: 'Unexpected response. Please try again.' });
        }
      } catch (err: unknown) {
        setState({ status: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
      }
    })();
  }, [authLoading, user, token, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg p-8">
      <div className="w-full max-w-md border border-border bg-surface p-8 text-center">
        {/* Brand */}
        <div className="mb-8">
          <span className="font-serif text-3xl font-bold italic">
            <span className="text-accent">Odyssey</span>
          </span>
        </div>

        {state.status === 'loading' && (
          <div className="space-y-4">
            <Loader2 size={36} className="animate-spin text-accent mx-auto" />
            <p className="text-sm text-muted">Verifying invite…</p>
          </div>
        )}

        {state.status === 'auth' && (
          <div className="space-y-4">
            <QrCode size={36} className="text-accent mx-auto" />
            <h2 className="font-sans text-lg font-bold text-heading">Sign in to join</h2>
            <p className="text-sm text-muted">
              You need to sign in with GitHub before joining this project.
            </p>
            <Link
              to={`/login?next=/join/qr/${token}`}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
            >
              Sign in with GitHub
              <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {state.status === 'joined' && (
          <div className="space-y-4">
            <CheckCircle size={36} className="text-accent2 mx-auto" />
            <h2 className="font-sans text-lg font-bold text-heading">You're in!</h2>
            <p className="text-sm text-muted">
              You joined <span className="text-heading font-semibold">{state.projectName}</span>.
              Redirecting…
            </p>
          </div>
        )}

        {state.status === 'requested' && (
          <div className="space-y-4">
            <CheckCircle size={36} className="text-accent mx-auto" />
            <h2 className="font-sans text-lg font-bold text-heading">Request sent</h2>
            <p className="text-sm text-muted">
              <span className="text-heading font-semibold">{state.projectName}</span> is private.
              The owners have been notified of your request.
            </p>
            <Link
              to="/projects"
              className="inline-flex items-center gap-2 px-5 py-2 border border-border text-muted text-xs font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
            >
              Back to Projects
            </Link>
          </div>
        )}

        {state.status === 'already' && (
          <div className="space-y-4">
            <CheckCircle size={36} className="text-accent2 mx-auto" />
            <h2 className="font-sans text-lg font-bold text-heading">Already a member</h2>
            <p className="text-sm text-muted">
              You're already part of <span className="text-heading font-semibold">{state.projectName}</span>.
            </p>
            <Link
              to={`/projects/${state.projectId}`}
              className="inline-flex items-center gap-2 px-5 py-2 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
            >
              Open Project
              <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {state.status === 'error' && (
          <div className="space-y-4">
            <XCircle size={36} className="text-danger mx-auto" />
            <h2 className="font-sans text-lg font-bold text-heading">Invalid invite</h2>
            <p className="text-sm text-muted">{state.message}</p>
            <Link
              to="/projects"
              className="inline-flex items-center gap-2 px-5 py-2 border border-border text-muted text-xs font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
            >
              Back to Projects
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
