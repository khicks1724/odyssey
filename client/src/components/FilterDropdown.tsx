import { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, X } from 'lucide-react';

export interface FilterSection {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
}

interface FilterDropdownProps {
  sections: FilterSection[];
  onChange: (sectionKey: string, selected: string[]) => void;
  placeholder?: string;
  buttonClassName?: string;
}

interface Pos { top: number; left: number; width: number }

export default function FilterDropdown({
  sections,
  onChange,
  placeholder = 'Filters',
  buttonClassName = '',
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0, width: 200 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(200, r.width) });
  }, []);

  const handleOpen = () => {
    reposition();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const repos = () => reposition();
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', repos, true);
    window.addEventListener('resize', repos);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', repos, true);
      window.removeEventListener('resize', repos);
    };
  }, [open, reposition]);

  const totalSelected = sections.reduce((n, s) => n + s.selected.length, 0);
  const isActive = totalSelected > 0;

  const toggle = (sectionKey: string, value: string, currentSelected: string[]) => {
    const next = currentSelected.includes(value)
      ? currentSelected.filter((v) => v !== value)
      : [...currentSelected, value];
    onChange(sectionKey, next);
  };

  const clearSection = (sectionKey: string) => onChange(sectionKey, []);
  const clearAll = () => sections.forEach((s) => onChange(s.key, []));

  let label = placeholder;
  if (isActive) {
    const parts = sections
      .filter((s) => s.selected.length > 0)
      .map((s) => s.selected.length === 1 ? s.selected[0] : `${s.selected.length} ${s.label}`);
    label = parts.join(', ');
  }

  const applyPanelStyle = (el: HTMLDivElement | null) => {
    (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (!el) return;
    el.style.position = 'fixed';
    el.style.top = `${pos.top}px`;
    el.style.left = `${pos.left}px`;
    el.style.minWidth = `${pos.width}px`;
    el.style.zIndex = '99999';
  };

  const panel = open ? createPortal(
    <div
      ref={applyPanelStyle}
      className="bg-surface border border-border rounded shadow-xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface2">
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted">Filters</span>
        {isActive && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-0.5 text-[9px] font-mono text-muted hover:text-danger transition-colors"
          >
            <X size={9} /> Clear all
          </button>
        )}
      </div>

      {/* Sections */}
      {sections.map((section, i) => {
        if (section.options.length === 0) return null;
        return (
          <div key={section.key} className={i > 0 ? 'border-t border-border' : ''}>
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[9px] font-mono uppercase tracking-widest text-muted">{section.label}</span>
              {section.selected.length > 0 && (
                <button
                  type="button"
                  onClick={() => clearSection(section.key)}
                  className="text-[9px] font-mono text-muted hover:text-danger transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="pb-1.5">
              {section.options.map((opt) => {
                const checked = section.selected.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-surface2 transition-colors group"
                  >
                    <span
                      className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors
                        ${checked ? 'bg-accent border-accent' : 'border-border group-hover:border-accent/50'}`}
                    >
                      {checked && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={`text-[10px] font-mono truncate max-w-[160px] ${checked ? 'text-heading' : 'text-muted group-hover:text-heading'}`}>
                      {opt.label}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggle(section.key, opt.value, section.selected)}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>,
    document.body
  ) : null;

  return (
    <div className="shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-[10px] font-mono h-[30px] transition-colors outline-none cursor-pointer
          ${isActive ? 'border-accent text-heading bg-accent/5' : 'border-border text-muted bg-surface2 hover:text-heading'} ${buttonClassName}`}
      >
        <span className="max-w-[200px] truncate">{label}</span>
        {isActive && (
          <span className="flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent/20 text-accent text-[9px] font-bold shrink-0">
            {totalSelected}
          </span>
        )}
        <ChevronDown size={10} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {panel}
    </div>
  );
}
