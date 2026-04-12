const SIDEBAR_COLLAPSED_STORAGE_KEY = 'odyssey-sidebar-collapsed';
export const SIDEBAR_COLLAPSE_EVENT = 'odyssey-sidebar-collapse-change';

export function getStoredSidebarCollapsed() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
}

export function setStoredSidebarCollapsed(collapsed: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  window.dispatchEvent(new CustomEvent<boolean>(SIDEBAR_COLLAPSE_EVENT, { detail: collapsed }));
}
