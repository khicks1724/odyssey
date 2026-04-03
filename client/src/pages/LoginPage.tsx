import { Github, Chrome } from 'lucide-react';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { signInWithGitHub, signInWithGoogle, signInWithMicrosoft } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="font-serif text-6xl font-bold italic text-heading mb-3">
          <span className="text-accent">Odyssey</span>
        </h1>
        <p className="font-serif text-lg text-muted italic mb-12">
          A unified project intelligence platform
        </p>

        <div className="flex flex-col gap-3 items-stretch">
          <button
            onClick={signInWithGitHub}
            className="inline-flex items-center justify-center gap-3 px-8 py-3 border border-border bg-surface hover:bg-surface2 text-heading font-sans font-semibold text-sm tracking-wide transition-colors rounded-md"
          >
            <Github size={18} />
            Sign in with GitHub
          </button>

          <button
            onClick={signInWithGoogle}
            className="inline-flex items-center justify-center gap-3 px-8 py-3 border border-border bg-surface hover:bg-surface2 text-heading font-sans font-semibold text-sm tracking-wide transition-colors rounded-md"
          >
            <Chrome size={18} />
            Sign in with Google
          </button>

          <button
            onClick={signInWithMicrosoft}
            className="inline-flex items-center justify-center gap-3 px-8 py-3 border border-border bg-surface hover:bg-surface2 text-heading font-sans font-semibold text-sm tracking-wide transition-colors rounded-md"
          >
            {/* Official Microsoft logo mark */}
            <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
              <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
            </svg>
            Sign in with Microsoft
          </button>
        </div>

        <p className="mt-8 text-xs text-muted/60 tracking-wide">
          All providers link to a single account — sign in with any one you used before.
        </p>

        <p className="mt-4 text-xs text-muted tracking-wider">
          ONE PLACE FOR EVERYTHING YOUR TEAM TOUCHES
        </p>
      </div>
    </div>
  );
}
