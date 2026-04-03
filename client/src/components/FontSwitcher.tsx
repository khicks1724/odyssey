import { useState, useRef, useEffect } from 'react';
import { useFontTheme, fontThemes } from '../lib/font-theme';
import './FontSwitcher.css';

const fontDesc: Record<string, string> = {
  default:       'Syne + DM Mono',
  bahnschrift:   'Geometric condensed',
  ubuntu:        'Clean modern sans-serif',
  consolas:      'Consolas monospace',
  'courier-new': 'Google sans-serif',
};

const PANEL_WIDTH = 220;

export default function FontSwitcher() {
  const { fontTheme, setFontTheme } = useFontTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative" style={{ width: PANEL_WIDTH }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Font theme"
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                   bg-[var(--color-surface)] border border-[var(--color-border)]
                   text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors cursor-pointer"
      >
        <span
          className="fs-sample text-[13px] font-semibold text-[var(--color-heading)] leading-none shrink-0"
          data-font-id={fontTheme.id}
        >
          Aa
        </span>
        <span className="flex-1 text-left text-sm text-[var(--color-text)] truncate">{fontTheme.name}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--color-muted)] shrink-0">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg border border-[var(--color-border)]
                     bg-[var(--color-surface)] shadow-xl z-50 overflow-hidden"
          style={{ width: PANEL_WIDTH }}
        >
          <div className="px-3 py-2 border-b border-[var(--color-border)]">
            <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] font-semibold">Font Theme</span>
          </div>
          <div className="py-1">
            {fontThemes.map((t) => {
              const isActive = t.id === fontTheme.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setFontTheme(t.id); setOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors cursor-pointer
                    ${isActive
                      ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
                      : 'text-[var(--color-text)] hover:bg-[var(--color-surface2)]'
                    }`}
                >
                  <span
                    className="fs-sample w-8 text-center text-base font-semibold shrink-0 text-[var(--color-heading)]"
                    data-font-id={t.id}
                  >
                    Aa
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[var(--color-heading)]">{t.name}</div>
                    <div className="text-[10px] text-[var(--color-muted)] mt-0.5">{fontDesc[t.id] ?? ''}</div>
                  </div>
                  {isActive && (
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" className="text-[var(--color-accent)] shrink-0">
                      <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
