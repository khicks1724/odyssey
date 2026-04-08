export const PROJECT_LABEL_PALETTE: string[] = [
  '#6a9fd8',
  '#3b82f6',
  '#60a5fa',
  '#1e40af',
  '#93c5fd',
  '#5a9e8a',
  '#10b981',
  '#34d399',
  '#059669',
  '#2dd4bf',
  '#7c3aed',
  '#8b5cf6',
  '#a78bfa',
  '#c084fc',
  '#e879f9',
  '#e05555',
  '#f97316',
  '#fb923c',
  '#eab308',
  '#fbbf24',
];

export function pickUnusedProjectLabelColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((color) => color.toLowerCase()));
  const available = PROJECT_LABEL_PALETTE.filter((color) => !used.has(color.toLowerCase()));
  const pool = available.length > 0 ? available : PROJECT_LABEL_PALETTE;
  return pool[Math.floor(Math.random() * pool.length)] ?? PROJECT_LABEL_PALETTE[0];
}
