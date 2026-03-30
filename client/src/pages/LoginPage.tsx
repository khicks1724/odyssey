import { Github, Chrome, Building2 } from 'lucide-react';
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
            <Building2 size={18} />
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
