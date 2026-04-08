import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export const ALL_TABS = [
  { id: 'overview',     label: 'Overview',     defaultVisible: true },
  { id: 'timeline',     label: 'Timeline',     defaultVisible: true },
  { id: 'activity',     label: 'Activity',     defaultVisible: true },
  { id: 'goals',        label: 'Tasks',        defaultVisible: true },
  { id: 'coordination', label: 'Coordination', defaultVisible: true },
  { id: 'metrics',      label: 'Metrics',      defaultVisible: false },
  { id: 'financials',   label: 'Financials',   defaultVisible: false },
  { id: 'reports',      label: 'Reports',      defaultVisible: true },
  { id: 'documents',    label: 'Documents',    defaultVisible: true },
  { id: 'integrations', label: 'Integrations', defaultVisible: false },
  { id: 'settings',     label: 'Settings',     defaultVisible: true },
] as const;

export type TabId = (typeof ALL_TABS)[number]['id'];

// overview and settings are always visible; cannot be hidden
const LOCKED_VISIBLE: TabId[] = ['overview', 'settings'];

// Custom event name used to synchronize multiple hook instances on the same page
const SYNC_EVENT = 'odyssey:tab-visibility-changed';

function storageKey(projectId: string, userId?: string | null) {
  return `odyssey-tab-visibility-${projectId}-${userId ?? 'anon'}`;
}

function defaultHiddenTabs(): Set<TabId> {
  return new Set(
    ALL_TABS
      .filter((tab) => !tab.defaultVisible && !LOCKED_VISIBLE.includes(tab.id))
      .map((tab) => tab.id),
  );
}

function normalizeStoredTabs(value: unknown): TabId[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tab): tab is TabId => ALL_TABS.some((candidate) => candidate.id === tab));
}

function readHidden(projectId: string, userId?: string | null): Set<TabId> {
  const defaults = defaultHiddenTabs();

  try {
    const raw = localStorage.getItem(storageKey(projectId, userId));
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as TabId[] | { hidden?: TabId[]; visible?: TabId[] };

    if (Array.isArray(parsed)) {
      normalizeStoredTabs(parsed)
        .filter((id) => !LOCKED_VISIBLE.includes(id))
        .forEach((id) => defaults.add(id));
      return defaults;
    }

    normalizeStoredTabs(parsed.hidden)
      .filter((id) => !LOCKED_VISIBLE.includes(id))
      .forEach((id) => defaults.add(id));

    normalizeStoredTabs(parsed.visible)
      .forEach((id) => defaults.delete(id));

    return defaults;
  } catch {
    return defaults;
  }
}

function writeHidden(projectId: string, hidden: Set<TabId>, userId?: string | null) {
  const hiddenTabs = [...hidden].filter((id) => !LOCKED_VISIBLE.includes(id));
  const visibleTabs = ALL_TABS
    .map((tab) => tab.id)
    .filter((id) => LOCKED_VISIBLE.includes(id) || !hidden.has(id));

  localStorage.setItem(storageKey(projectId, userId), JSON.stringify({
    hidden: hiddenTabs,
    visible: visibleTabs,
  }));
}

export function useTabVisibility(projectId: string | undefined) {
  const { user } = useAuth();
  const [hidden, setHidden] = useState<Set<TabId>>(() =>
    projectId ? readHidden(projectId) : defaultHiddenTabs()
  );

  useEffect(() => {
    if (!projectId) {
      setHidden(defaultHiddenTabs());
      return;
    }
    setHidden(readHidden(projectId, user?.id));
  }, [projectId, user?.id]);

  useEffect(() => {
    if (!projectId || !user?.id) return;

    let cancelled = false;

    void supabase
      .from('project_user_preferences')
      .select('visible_tabs')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data?.visible_tabs) return;
        const visibleTabs = Array.isArray(data.visible_tabs)
          ? data.visible_tabs.filter((tab): tab is TabId => ALL_TABS.some((candidate) => candidate.id === tab))
          : [];
        const nextHidden = new Set<TabId>(
          ALL_TABS
            .map((tab) => tab.id)
            .filter((tabId) => !LOCKED_VISIBLE.includes(tabId) && !visibleTabs.includes(tabId)),
        );
        writeHidden(projectId, nextHidden, user.id);
        setHidden(nextHidden);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

  // Re-sync when another hook instance on this page changes visibility
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const ev = e as CustomEvent<string>;
      if (ev.detail === projectId) {
        setHidden(readHidden(projectId, user?.id));
      }
    };
    window.addEventListener(SYNC_EVENT, handler);
    return () => window.removeEventListener(SYNC_EVENT, handler);
  }, [projectId, user?.id]);

  const isVisible = useCallback((id: TabId) => !hidden.has(id), [hidden]);

  const setTabVisible = useCallback((id: TabId, visible: boolean) => {
    if (LOCKED_VISIBLE.includes(id)) return;
    setHidden((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(id); else next.add(id);
      if (projectId) {
        writeHidden(projectId, next, user?.id);
        if (user?.id) {
          const visibleTabs = ALL_TABS
            .map((tab) => tab.id)
            .filter((tabId) => LOCKED_VISIBLE.includes(tabId) || !next.has(tabId));
          void supabase
            .from('project_user_preferences')
            .upsert({
              project_id: projectId,
              user_id: user.id,
              visible_tabs: visibleTabs,
            });
        }
        // Notify all other hook instances on this page
        window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: projectId }));
      }
      return next;
    });
  }, [projectId, user?.id]);

  const visibleTabs = ALL_TABS.filter((t) => !hidden.has(t.id));

  return { isVisible, setTabVisible, visibleTabs, lockedVisible: LOCKED_VISIBLE };
}
