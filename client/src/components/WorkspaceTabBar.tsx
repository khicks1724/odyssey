import type { LucideIcon } from 'lucide-react';
import './WorkspaceTabBar.css';

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
  return (
    <div className={`workspace-tab-bar mb-8 ${className}`.trim()}>
      <div
        className={`workspace-tab-list w-full gap-px border border-border bg-border ${stretch ? 'grid' : 'flex'}`}
        role="tablist"
        aria-label="Workspace sections"
        style={{
          '--workspace-tab-count': tabs.length,
          '--workspace-tab-min-width': `${tabs.length * 2.75}rem`,
        } as React.CSSProperties}
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            role="tab"
            aria-selected={activeTab === id}
            aria-label={label}
            title={label}
            className={`workspace-tab-button relative flex min-w-0 items-center justify-center gap-1 bg-surface px-2 py-3 text-[10px] font-semibold leading-none tracking-[0.08em] uppercase text-center transition-colors sm:gap-1.5 sm:px-3 sm:text-[11px] sm:tracking-[0.1em] lg:gap-2 lg:px-4 lg:py-3.5 lg:text-xs lg:tracking-[0.14em] ${
              stretch ? '' : 'grow'
            } ${
              activeTab === id
                ? 'bg-surface2 text-accent shadow-[inset_0_-2px_0_0_var(--color-accent)]'
                : 'text-muted hover:bg-surface2 hover:text-heading'
            }`}
          >
            <Icon aria-hidden="true" className="workspace-tab-icon shrink-0" />
            <span className="workspace-tab-label min-w-0 whitespace-nowrap">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
