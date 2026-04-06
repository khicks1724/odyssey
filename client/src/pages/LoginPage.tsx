import { Github } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { normalizeUsername, validatePassword, validateUsername } from '../lib/username-auth';

type AuthMode = 'signin' | 'signup';

export default function LoginPage() {
  const location = useLocation();
  const {
    signInWithUsernamePassword,
    registerWithUsernamePassword,
    signInWithGitHub,
    signInWithMicrosoft,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  const authError =
    typeof location.state === 'object' &&
    location.state !== null &&
    'authError' in location.state &&
    typeof location.state.authError === 'string'
      ? location.state.authError
      : null;

  const currentError = formError ?? authError;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);

    const usernameError = validateUsername(username);
    if (usernameError) {
      setFormError(usernameError);
      return;
    }

    if (mode === 'signup') {
      const passwordError = validatePassword(password);
      if (passwordError) {
        setFormError(passwordError);
        return;
      }
    } else if (!password) {
      setFormError('Password is required.');
      return;
    }

    const normalizedUsername = normalizeUsername(username);

    try {
      setSubmitting(true);
      if (mode === 'signup') {
        const result = await registerWithUsernamePassword({
          username: normalizedUsername,
          password,
          displayName: displayName.trim() || normalizedUsername,
        });
        setMode('signin');
        setPassword('');
        setFormNotice(`Account created for ${result.username}. Sign in with your username and password.`);
      } else {
        await signInWithUsernamePassword(normalizedUsername, password);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 overflow-y-auto">
      <div className="w-full max-w-5xl rounded-[28px] border border-border/80 bg-surface/95 shadow-[0_30px_120px_rgba(15,31,51,0.16)] overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
          <section className="relative px-8 py-10 sm:px-12 sm:py-14 bg-[radial-gradient(circle_at_top_left,_rgba(42,90,143,0.2),_transparent_36%),linear-gradient(135deg,_rgba(30,58,95,0.1),_rgba(58,122,106,0.18))]">
            <div className="max-w-xl">
              <p className="text-xs uppercase tracking-[0.35em] text-accent2/80 mb-5">Project Intelligence</p>
              <h1 className="font-serif text-6xl font-bold italic text-heading mb-4">
                <span className="text-accent">Odyssey</span>
              </h1>
              <p className="font-serif text-xl text-heading/80 italic max-w-lg mb-10">
                Sign in with a username and password or keep using your linked Microsoft and GitHub accounts.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-border/80 bg-bg/60 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted mb-2">Security</p>
                  <p className="text-sm text-heading/85">
                    Passwords stay in Supabase Auth, not in Odyssey tables, and usernames are reserved case-insensitively.
                  </p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-bg/60 p-5">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted mb-2">Username Rules</p>
                  <p className="text-sm text-heading/85">
                    Usernames use 3-32 lowercase letters, numbers, or underscores. Passwords must be at least 10 characters long and can use any characters.
                  </p>
                </div>
              </div>

              <p className="mt-10 text-xs text-muted tracking-[0.28em]">
                ONE PLACE FOR EVERYTHING YOUR TEAM TOUCHES
              </p>
            </div>
          </section>

          <section className="px-8 py-10 sm:px-10 sm:py-12 bg-bg/85">
            <div className="inline-flex rounded-full border border-border bg-surface2 p-1 mb-6">
              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setFormError(null);
                  setFormNotice(null);
                }}
                className={`rounded-full px-4 py-2 text-xs font-semibold tracking-[0.18em] uppercase transition-colors ${
                  mode === 'signin' ? 'bg-heading text-bg' : 'text-muted hover:text-heading'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setFormError(null);
                  setFormNotice(null);
                }}
                className={`rounded-full px-4 py-2 text-xs font-semibold tracking-[0.18em] uppercase transition-colors ${
                  mode === 'signup' ? 'bg-heading text-bg' : 'text-muted hover:text-heading'
                }`}
              >
                Create account
              </button>
            </div>

            <form className="space-y-4" onSubmit={onSubmit}>
              <label className="block">
                <span className="block text-xs uppercase tracking-[0.22em] text-muted mb-2">Username</span>
                <input
                  type="text"
                  autoComplete={mode === 'signup' ? 'username' : 'username'}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="team_operator"
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-heading outline-none transition focus:border-accent"
                  disabled={submitting}
                />
                {mode === 'signin' && (
                  <p className="mt-2 text-xs text-muted">
                    Use your exact Odyssey username, not your display name or email.
                  </p>
                )}
              </label>

              {mode === 'signup' && (
                <label className="block">
                  <span className="block text-xs uppercase tracking-[0.22em] text-muted mb-2">Display name</span>
                  <input
                    type="text"
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="Optional, defaults to username"
                    className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-heading outline-none transition focus:border-accent"
                    disabled={submitting}
                  />
                </label>
              )}

              <label className="block">
                <span className="block text-xs uppercase tracking-[0.22em] text-muted mb-2">Password</span>
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={mode === 'signup' ? '10 or more characters' : 'Enter your password'}
                  className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm text-heading outline-none transition focus:border-accent"
                  disabled={submitting}
                />
              </label>

              {currentError && (
                <p className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">
                  {currentError}
                </p>
              )}

              {formNotice && (
                <p className="rounded-2xl border border-accent2/20 bg-accent2/8 px-4 py-3 text-sm text-heading">
                  {formNotice}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-2xl bg-heading px-4 py-3 text-sm font-semibold uppercase tracking-[0.18em] text-bg transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting
                  ? mode === 'signup' ? 'Creating account…' : 'Signing in…'
                  : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            </form>

            <div className="flex items-center gap-3 my-6">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-[0.26em] text-muted">or use a linked provider</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <div className="flex flex-col gap-3 items-stretch">
              <button
                onClick={signInWithMicrosoft}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-semibold tracking-[0.08em] text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                  <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                  <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                  <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                </svg>
                Sign in with Microsoft
              </button>

              <button
                onClick={signInWithGitHub}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-3 rounded-2xl border border-border bg-surface px-5 py-3 text-sm font-semibold tracking-[0.08em] text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Github size={18} />
                Sign in with GitHub
              </button>
            </div>

            <p className="mt-6 text-xs text-muted leading-6">
              Existing OAuth users can keep signing in normally. New username/password accounts are created with collision checks and a single reserved username per account.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
