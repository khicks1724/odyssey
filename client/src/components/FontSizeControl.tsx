import { useState, useEffect } from 'react';

// Root font-size steps. Browser default is 16px.
// Step 0 = 16px → body becomes 0.8125 * 16 = 13px (app default).
// All Tailwind rem-based classes (text-xs, text-sm, etc.) scale proportionally.
const STEPS = [-3, -2, -1, 0, 1, 2, 3, 4, 5] as const;
type Step = typeof STEPS[number];
const ROOT_BASE = 16;
const LS_KEY = 'odyssey-font-size-step';

function applyStep(step: number) {
  document.documentElement.style.fontSize = `${ROOT_BASE + step}px`;
}

export default function FontSizeControl() {
  const [step, setStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const saved = parseInt(window.localStorage.getItem(LS_KEY) ?? '0', 10);
    return STEPS.includes(saved as Step) ? saved : 0;
  });

  useEffect(() => {
    applyStep(step);
  }, [step]);

  const change = (delta: number) => {
    setStep((prev) => {
      const next = Math.max(-3, Math.min(5, prev + delta)) as Step;
      window.localStorage.setItem(LS_KEY, String(next));
      return next;
    });
  };

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => change(-1)}
        disabled={step <= -3}
        title="Decrease font size"
        className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--color-border)]
                   bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-heading)]
                   hover:bg-[var(--color-surface2)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <span className="text-[10px] font-bold leading-none select-none">A−</span>
      </button>

      {step !== 0 && (
        <button
          type="button"
          onClick={() => change(-step)}
          title="Reset font size"
          className="text-[9px] font-mono text-[var(--color-accent2)] hover:text-[var(--color-heading)] w-6 text-center select-none tabular-nums transition-colors cursor-pointer"
        >
          {step > 0 ? `+${step}` : step}
        </button>
      )}
      {step === 0 && (
        <span className="text-[9px] font-mono text-[var(--color-muted)]/50 w-6 text-center select-none tabular-nums">
          ●
        </span>
      )}

      <button
        type="button"
        onClick={() => change(1)}
        disabled={step >= 5}
        title="Increase font size"
        className="flex items-center justify-center w-7 h-7 rounded-lg border border-[var(--color-border)]
                   bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-heading)]
                   hover:bg-[var(--color-surface2)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
      >
        <span className="text-[11px] font-bold leading-none select-none">A+</span>
      </button>
    </div>
  );
}
