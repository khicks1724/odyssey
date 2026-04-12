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
      className="inline-flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
      aria-label="Page view mode"
    >
      <button
        type="button"
        onClick={() => setMode('extended')}
        aria-pressed={mode === 'extended'}
        className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.02em] transition-colors ${
          mode === 'extended'
            ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
            : 'text-[var(--color-muted)] hover:text-[var(--color-heading)]'
        }`}
      >
        Extended View
      </button>
      <button
        type="button"
        onClick={() => setMode('relaxed')}
        aria-pressed={mode === 'relaxed'}
        className={`rounded-md px-2.5 py-1.5 text-[10px] font-semibold tracking-[0.02em] transition-colors ${
          mode === 'relaxed'
            ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
            : 'text-[var(--color-muted)] hover:text-[var(--color-heading)]'
        }`}
      >
        Relaxed View
      </button>
    </div>
  );
}
