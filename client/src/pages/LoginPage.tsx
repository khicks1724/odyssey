import { useRef, useState, type CSSProperties } from 'react';
import { useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../lib/auth';
import DateTime from '../components/DateTime';
import LoginWaveBackground from '../components/LoginWaveBackground';
import { normalizeUsername, validatePassword, validateUsername } from '../lib/username-auth';

type AuthMode = 'signin' | 'signup';

const LOGIN_THEME_STYLE = {
  '--color-bg': '#f5f0e8',
  '--color-surface': '#ece7df',
  '--color-surface2': '#e2ddd4',
  '--color-border': '#c8c0b4',
  '--color-accent': '#1e3a5f',
  '--color-accent2': '#2a5a8f',
  '--color-accent3': '#3a7a6a',
  '--color-danger': '#b91c1c',
  '--color-text': '#1e3a5f',
  '--color-muted': '#6b7a8d',
  '--color-heading': '#0f1f33',
  '--color-accent-fg': '#ffffff',
  '--color-code-static': '#1e3a5f',
  '--color-code-static-bg': '#e2ddd4cc',
  '--color-code-static-border': '#c8c0b4cc',
  '--color-code-file': '#1e3a5f',
  '--color-code-file-bg': '#1e3a5f1f',
  '--color-code-file-border': '#1e3a5f55',
  '--color-code-repo': '#2a5a8f',
  '--color-code-repo-bg': '#2a5a8f1f',
  '--color-code-repo-border': '#2a5a8f55',
  '--color-code-task': '#3a7a6a',
  '--color-code-task-bg': '#3a7a6a1f',
  '--color-code-task-border': '#3a7a6a55',
  '--font-sans': '"Syne", sans-serif',
  '--font-mono': '"DM Mono", monospace',
  '--font-serif': '"Fraunces", serif',
  '--font-ui': '"DM Mono", monospace',
  '--font-heading-display': '"Syne", sans-serif',
  '--font-scale': '1',
  '--font-tracking': 'normal',
  fontFamily: 'var(--font-ui)',
} as CSSProperties;

export default function LoginPage() {
  const location = useLocation();
  const loginCardRef = useRef<HTMLDivElement | null>(null);
  const {
    signInWithUsernamePassword,
    registerWithUsernamePassword,
    signInWithMicrosoft,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="login-theme-scope relative min-h-screen overflow-y-auto" style={LOGIN_THEME_STYLE}>
      <LoginWaveBackground interactionTargetRef={loginCardRef} />

      <div className="relative z-10 min-h-screen flex flex-col px-6 py-6">
        <div className="flex-1 flex items-center justify-center">
          <div
            ref={loginCardRef}
            className="w-full max-w-5xl rounded-[28px] border border-border/80 bg-surface/92 shadow-[0_32px_120px_rgba(15,31,51,0.16)] backdrop-blur-[2px] overflow-hidden"
          >
          <div className="flex items-center px-6 h-11 border-b border-border/80 bg-surface/90">
            <DateTime />
          </div>

          <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
            <section className="relative flex items-center px-8 py-10 sm:px-12 sm:py-14 bg-[radial-gradient(circle_at_top_left,_rgba(42,90,143,0.18),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.26),_rgba(42,90,143,0.06))]">
              <div className="max-w-2xl pt-2 sm:pt-4">
                <h1 className="font-serif text-7xl sm:text-8xl font-bold italic text-heading mb-5">
                  <span className="text-accent">Odyssey</span>
                </h1>
                <p className="mt-12 text-xs uppercase tracking-[0.35em] text-accent2/80">Project Intelligence</p>

                <div className="mt-10 max-w-xl">
                  <div className="rounded-2xl border border-border/80 bg-bg/60 px-7 py-5">
                    <p className="text-xs uppercase tracking-[0.24em] text-muted mb-2">Username Rules</p>
                    <p className="max-w-md text-sm leading-7 text-heading/85">
                      Usernames must be 3-32 characters. Passwords must be at least 10 characters.
                    </p>
                  </div>
                </div>

                <p className="mt-10 text-xs text-muted tracking-[0.28em]">
                  ONE PLACE FOR ALL OF YOUR PROJECT INSIGHTS
                </p>
              </div>
            </section>

            <section className="px-8 py-8 sm:px-10 sm:py-10 bg-bg/85">
              <div className="mt-2 space-y-2 mb-6">
                <button
                  onClick={signInWithMicrosoft}
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-4 rounded-3xl border border-border bg-surface px-6 py-5 text-lg font-semibold tracking-[0.06em] text-heading shadow-[0_18px_48px_rgba(15,31,51,0.12)] transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  <svg width="22" height="22" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
                    <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
                    <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
                    <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
                  </svg>
                  Sign in with Microsoft
                </button>
                <p className="text-center text-sm text-muted leading-6">
                  Use your linked Microsoft account for sign-in.
                </p>
              </div>

              <div className="flex items-center gap-3 mb-5">
                <div className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-[0.26em] text-muted">or sign in with username and password</span>
                <div className="h-px flex-1 bg-border" />
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
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={mode === 'signup' ? '10 or more characters' : 'Enter your password'}
                      className="w-full rounded-2xl border border-border bg-surface px-4 py-3 pr-11 text-sm text-heading outline-none transition focus:border-accent"
                      disabled={submitting}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-heading transition-colors"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
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

                <div className="pt-1 text-center">
                  {mode === 'signin' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signup');
                        setFormError(null);
                        setFormNotice(null);
                      }}
                      className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted transition-colors hover:text-heading"
                    >
                      Or create an account
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMode('signin');
                        setFormError(null);
                        setFormNotice(null);
                      }}
                      className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted transition-colors hover:text-heading"
                    >
                      Back to sign in
                    </button>
                  )}
                </div>
              </form>
            </section>
          </div>
        </div>
        </div>
        <p className="pt-4 text-center text-[11px] tracking-[0.18em] text-muted">
          Created by Kyle Hicks - Naval Postgraduate School - 2026
        </p>
      </div>
    </div>
  );
}
