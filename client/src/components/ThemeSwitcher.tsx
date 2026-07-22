import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useTheme, themes } from '../lib/theme';
import './ThemeSwitcher.css';

function PreviewDots({ colors }: { colors: [string, string, string] }) {
  return (
    <span className="theme-preview" aria-hidden="true">
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="theme-preview__dot"
          style={{ '--theme-preview-color': color } as CSSProperties}
        />
      ))}
    </span>
  );
}

export default function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const activeColors = (theme.previewColors ?? [theme.colors.bg, theme.colors.accent, theme.colors.accent3]) as [string, string, string];

  return (
    <div ref={ref} className="theme-switcher">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="theme-switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Color theme"
      >
        <PreviewDots colors={activeColors} />
        <span className="theme-switcher__current" title={theme.name}>{theme.name}</span>
        <ChevronDown size={14} className={`theme-switcher__chevron ${open ? 'theme-switcher__chevron--open' : ''}`} />
      </button>

      {open && (
        <div className="theme-switcher__menu" role="menu" aria-label="Color theme">
          <div className="theme-switcher__menu-header">
            <span>Color theme</span>
            <span className="theme-switcher__count">{themes.length}</span>
          </div>
          <div className="theme-switcher__options">
            {themes.map((candidate) => {
              const dots = (candidate.previewColors ?? [candidate.colors.bg, candidate.colors.accent, candidate.colors.accent3]) as [string, string, string];
              const isActive = candidate.id === theme.id;

              return (
                <button
                  key={candidate.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    setTheme(candidate.id);
                    setOpen(false);
                  }}
                  className={`theme-switcher__option ${isActive ? 'theme-switcher__option--active' : ''}`}
                >
                  <PreviewDots colors={dots} />
                  <span className="theme-switcher__label">{candidate.name}</span>
                  <span className="theme-switcher__check" aria-hidden="true">
                    {isActive && <Check size={15} strokeWidth={2.25} />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
