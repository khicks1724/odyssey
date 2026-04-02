import { useState, useCallback, useEffect } from 'react';

export const ALL_TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'timeline',     label: 'Timeline' },
  { id: 'activity',     label: 'Activity' },
  { id: 'goals',        label: 'Tasks' },
  { id: 'metrics',      label: 'Metrics' },
  { id: 'financials',   label: 'Financials' },
  { id: 'reports',      label: 'Reports' },
  { id: 'documents',    label: 'Documents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'settings',     label: 'Settings' },
] as const;

export type TabId = (typeof ALL_TABS)[number]['id'];

// overview and settings are always visible; cannot be hidden
const LOCKED_VISIBLE: TabId[] = ['overview', 'settings'];

// Custom event name used to synchronize multiple hook instances on the same page
const SYNC_EVENT = 'odyssey:tab-visibility-changed';

function storageKey(projectId: string) {
  return `odyssey-tab-visibility-${projectId}`;
}

function readHidden(projectId: string): Set<TabId> {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as TabId[];
    return new Set(arr.filter((id) => !LOCKED_VISIBLE.includes(id)));
  } catch {
    return new Set();
  }
}

function writeHidden(projectId: string, hidden: Set<TabId>) {
  const arr = [...hidden].filter((id) => !LOCKED_VISIBLE.includes(id));
  localStorage.setItem(storageKey(projectId), JSON.stringify(arr));
}

export function useTabVisibility(projectId: string | undefined) {
  const [hidden, setHidden] = useState<Set<TabId>>(() =>
    projectId ? readHidden(projectId) : new Set()
  );

  // Re-sync when another hook instance on this page changes visibility
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const ev = e as CustomEvent<string>;
      if (ev.detail === projectId) {
        setHidden(readHidden(projectId));
      }
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [projectId]);

  const isVisible = useCallback((id: TabId) => !hidden.has(id), [hidden]);

  const setTabVisible = useCallback((id: TabId, visible: boolean) => {
    if (LOCKED_VISIBLE.includes(id)) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id); else next.add(id);
      if (projectId) {
        writeHidden(projectId, next);
        // Notify all other hook instances on this page
        window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: projectId }));
      }
      return next;
    });
  }, [projectId]);

  const visibleTabs = ALL_TABS.filter((t) => !hidden.has(t.id));

  return { isVisible, setTabVisible, visibleTabs, lockedVisible: LOCKED_VISIBLE };
}
