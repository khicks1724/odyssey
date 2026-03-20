import type { Project } from '../types';

/* ── Sort modes ───────────────────────────────────────────────────────────── */

export type ProjectSortMode = 'alpha-asc' | 'alpha-desc' | 'date-asc' | 'date-desc' | 'custom';

const SORT_KEY = 'odyssey-project-sort';
const ORDER_KEY = 'odyssey-project-order';

export function getSortMode(): ProjectSortMode {
  return (localStorage.getItem(SORT_KEY) as ProjectSortMode) ?? 'date-desc';
}

export function setSortMode(mode: ProjectSortMode) {
  localStorage.setItem(SORT_KEY, mode);
}

export function getCustomOrder(): string[] {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]'); }
  catch { return []; }
}

export function setCustomOrder(ids: string[]) {
  localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
}

/* ── Sort function ────────────────────────────────────────────────────────── */

export function sortProjects(projects: Project[], mode: ProjectSortMode): Project[] {
  const list = [...projects];
  switch (mode) {
    case 'alpha-asc':
      return list.sort((a, b) => a.name.localeCompare(b.name));
    case 'alpha-desc':
      return list.sort((a, b) => b.name.localeCompare(a.name));
    case 'date-asc':
      return list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    case 'date-desc':
      return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    case 'custom': {
      const order = getCustomOrder();
      const idx = new Map(order.map((id, i) => [id, i]));
      return list.sort((a, b) => {
        const ai = idx.get(a.id) ?? Infinity;
        const bi = idx.get(b.id) ?? Infinity;
        if (ai !== bi) return ai - bi;
        // Fallback: date-desc for projects not yet in custom order
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }
    default:
      return list;
  }
}
