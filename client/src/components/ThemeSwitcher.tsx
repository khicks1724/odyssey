import { useState, useRef, useEffect } from 'react';
import { useTheme, themes } from '../lib/theme';
import './ThemeSwitcher.css';

function PreviewDots({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="flex gap-0.5 shrink-0">
      {colors.map((c, i) => (
        // eslint-disable-next-line react/forbid-component-props
        <span key={i} className="w-3 h-3 rounded-full border border-black/20" style={{ background: c }} />
      ))}
    </span>
  );
}

function ThemeLabel({ id, name }: { id: string; name: string }) {
  if (id === 'usa') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-5 rounded-[2px] border border-black/20 overflow-hidden shrink-0"
        >
          <svg viewBox="0 0 19 10" className="h-full w-full block" xmlns="http://www.w3.org/2000/svg">
            <rect width="19" height="10" fill="#fff" />
            <rect width="19" height="0.769" y="0" fill="#b22234" />
            <rect width="19" height="0.769" y="1.538" fill="#b22234" />
            <rect width="19" height="0.769" y="3.076" fill="#b22234" />
            <rect width="19" height="0.769" y="4.614" fill="#b22234" />
            <rect width="19" height="0.769" y="6.152" fill="#b22234" />
            <rect width="19" height="0.769" y="7.69" fill="#b22234" />
            <rect width="19" height="0.769" y="9.228" fill="#b22234" />
            <rect width="7.6" height="5.384" fill="#3c3b6e" />
          </svg>
        </span>
        <span>USA</span>
      </span>
    );
  }

  return <span>{name}</span>;
}

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeColors = (theme.previewColors ?? [theme.colors.bg, theme.colors.accent, theme.colors.accent3]) as [string, string, string];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-64 flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                   bg-[var(--color-surface)] border border-[var(--color-border)]
                   text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors cursor-pointer"
      >
        <PreviewDots colors={activeColors} />
        <span className="flex-1 text-left whitespace-nowrap"><ThemeLabel id={theme.id} name={theme.name} /></span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--color-muted)] shrink-0">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-64 rounded-lg border border-[var(--color-border)]
                     bg-[var(--color-surface)] shadow-xl z-50 py-1"
        >
          {themes.map((t) => {
            const dots = (t.previewColors ?? [t.colors.bg, t.colors.accent, t.colors.accent3]) as [string, string, string];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTheme(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors cursor-pointer
                  ${t.id === theme.id
                    ? 'bg-[var(--color-surface2)] text-[var(--color-heading)]'
                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface2)]'
                  }`}
              >
                <PreviewDots colors={dots} />
                <span><ThemeLabel id={t.id} name={t.name} /></span>
                {t.id === theme.id && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="ml-auto text-[var(--color-accent)]">
                    <path d="M3 7L6 10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
