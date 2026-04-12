import type { LucideIcon } from 'lucide-react';

type WorkspaceTab<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
};

interface WorkspaceTabBarProps<T extends string> {
  tabs: readonly WorkspaceTab<T>[];
  activeTab: T;
  onChange: (tabId: T) => void;
  stretch?: boolean;
  className?: string;
}

export default function WorkspaceTabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
  stretch = false,
  className = '',
}: WorkspaceTabBarProps<T>) {
  const gridTemplateColumns = stretch
    ? tabs
        .map(({ label }) => {
          const weight = Math.max(8, Math.min(18, label.replace(/\s+/g, '').length));
          return `minmax(0, ${weight}fr)`;
        })
        .join(' ')
    : undefined;

  return (
    <div className={`mb-8 ${className}`.trim()}>
      <div
        className={`w-full gap-px border border-border bg-border ${stretch ? 'grid' : 'flex'}`}
        style={gridTemplateColumns ? { gridTemplateColumns } : undefined}
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative flex min-w-0 items-center justify-center gap-1 bg-surface px-2 py-3 text-[10px] font-semibold leading-none tracking-[0.08em] uppercase text-center transition-colors first:rounded-tl last:rounded-tr sm:gap-1.5 sm:px-3 sm:text-[11px] sm:tracking-[0.1em] lg:gap-2 lg:px-4 lg:py-3.5 lg:text-xs lg:tracking-[0.14em] ${
              stretch ? '' : 'grow'
            } ${
              activeTab === id
                ? 'bg-surface2 text-accent shadow-[inset_0_-2px_0_0_var(--color-accent)]'
                : 'text-muted hover:bg-surface2 hover:text-heading'
            }`}
          >
            <Icon size={13} className="shrink-0" />
            <span className="min-w-0 whitespace-nowrap">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
