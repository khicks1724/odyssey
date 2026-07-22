import { useEffect, useState } from 'react';

type ViewMode = 'relaxed' | 'extended';

const LS_KEY = 'odyssey-view-mode';

function readStoredMode(): ViewMode {
  if (typeof window === 'undefined') return 'extended';
  const stored = window.localStorage.getItem(LS_KEY);
  return stored === 'relaxed' ? 'relaxed' : 'extended';
}

export default function ViewModeToggle() {
  const [mode, setMode] = useState<ViewMode>(readStoredMode);

  useEffect(() => {
    document.documentElement.dataset.viewMode = mode;
    window.localStorage.setItem(LS_KEY, mode);

    return () => {
      delete document.documentElement.dataset.viewMode;
    };
  }, [mode]);

  return (
    <div
      className="app-view-mode-control inline-flex h-8 items-stretch overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm"
      aria-label="Page view mode"
    >
      <button
        type="button"
        onClick={() => setMode('extended')}
        aria-pressed={mode === 'extended'}
        title="Use the full available page width"
        className={`px-3 text-xs font-medium transition-colors ${
          mode === 'extended'
            ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
            : 'text-[var(--color-muted)] hover:text-[var(--color-heading)]'
        }`}
      >
        Extended
      </button>
      <button
        type="button"
        onClick={() => setMode('relaxed')}
        aria-pressed={mode === 'relaxed'}
        title="Use a centered reading width"
        className={`px-3 text-xs font-medium transition-colors ${
          mode === 'relaxed'
            ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
            : 'text-[var(--color-muted)] hover:text-[var(--color-heading)]'
        }`}
      >
        Relaxed
      </button>
    </div>
  );
}
