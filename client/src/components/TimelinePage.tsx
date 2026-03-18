import { useRef, useState, useEffect, useCallback } from 'react';
import type { Goal } from '../types';

/* ─── Category colors assigned by AI or fallback heuristics ─── */
const CATEGORY_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  'Frontend':    { bg: 'rgba(59,142,234,0.35)', border: '#3b8eea', label: '#3b8eea' },
  'Backend':     { bg: 'rgba(82,201,142,0.35)', border: '#52c98e', label: '#52c98e' },
  'Design':      { bg: 'rgba(189,147,249,0.35)', border: '#bd93f9', label: '#bd93f9' },
  'DevOps':      { bg: 'rgba(232,162,53,0.35)', border: '#e8a235', label: '#e8a235' },
  'Testing':     { bg: 'rgba(232,85,85,0.35)',  border: '#e85555', label: '#e85555' },
  'Planning':    { bg: 'rgba(120,220,232,0.35)', border: '#78dce8', label: '#78dce8' },
};

const DEFAULT_CATEGORY = { bg: 'rgba(90,106,126,0.3)', border: '#5a6a7e', label: '#5a6a7e' };

const CATEGORY_KEYS = Object.keys(CATEGORY_COLORS);

interface CategoryMap {
  [goalId: string]: string;
}

/* ─── Simple keyword-based fallback when AI is unavailable ─── */
function fallbackCategorize(goals: Goal[]): CategoryMap {
  const map: CategoryMap = {};
  const keywords: Record<string, string[]> = {
    Frontend:  ['ui', 'frontend', 'component', 'css', 'design', 'layout', 'page', 'react', 'style', 'theme'],
    Backend:   ['api', 'backend', 'server', 'database', 'endpoint', 'auth', 'route', 'supabase'],
    Design:    ['design', 'mockup', 'wireframe', 'figma', 'ux', 'brand', 'logo'],
    DevOps:    ['deploy', 'ci', 'cd', 'docker', 'pipeline', 'infra', 'hosting', 'build', 'cloud'],
    Testing:   ['test', 'qa', 'bug', 'fix', 'debug', 'lint', 'coverage'],
    Planning:  ['plan', 'roadmap', 'milestone', 'scope', 'spec', 'doc', 'research', 'review'],
  };
  for (const goal of goals) {
    const lower = goal.title.toLowerCase();
    let matched = false;
    for (const [cat, words] of Object.entries(keywords)) {
      if (words.some((w) => lower.includes(w))) {
        map[goal.id] = cat;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Distribute uncategorized goals evenly
      map[goal.id] = CATEGORY_KEYS[goals.indexOf(goal) % CATEGORY_KEYS.length];
    }
  }
  return map;
}

/* ─── AI categorization via backend ─── */
// Simple in-memory cache to avoid burning AI quota on every page visit
const categoryCache = new Map<string, CategoryMap>();

async function aiCategorize(goals: Goal[], projectName: string): Promise<CategoryMap | null> {
  // Build cache key from goal IDs + statuses
  const cacheKey = goals.map((g) => `${g.id}:${g.status}`).join('|') + '|' + projectName;
  const cached = categoryCache.get(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch('/api/ai/categorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectName,
        goals: goals.map((g) => ({ id: g.id, title: g.title, status: g.status })),
        categories: CATEGORY_KEYS,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.categories as CategoryMap;
    categoryCache.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/* ─── Constants ─── */
const DAY_MS = 86_400_000;
const PX_PER_DAY = 40; // pixels per day
const ROW_HEIGHT = 52;
const ROW_GAP = 2;
const HEADER_HEIGHT = 40;
const BOTTOM_AXIS = 32;

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthYear(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

interface TimelinePageProps {
  goals: Goal[];
  projectName: string;
}

export default function TimelinePage({ goals, projectName }: TimelinePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [categories, setCategories] = useState<CategoryMap>({});

  const goalsWithDeadline = goals
    .filter((g) => g.deadline)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

  // Categorize goals
  useEffect(() => {
    if (goalsWithDeadline.length === 0) return;
    // Start with fallback
    setCategories(fallbackCategorize(goalsWithDeadline));
    // Try AI
    aiCategorize(goalsWithDeadline, projectName).then((result) => {
      if (result) setCategories(result);
    });
  }, [goals.length, projectName]);

  // Position "today" at 1/4 of the viewport on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || goalsWithDeadline.length === 0) return;
    const now = new Date();
    const earliest = new Date(goalsWithDeadline[0].deadline!);
    const rangeStart = new Date(Math.min(now.getTime(), earliest.getTime()) - 30 * DAY_MS);
    const todayOffset = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
    el.scrollLeft = todayOffset - el.clientWidth * 0.25;
  }, [goalsWithDeadline.length]);

  // Drag handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    setDragging(true);
    setStartX(e.pageX - el.offsetLeft);
    setScrollLeft(el.scrollLeft);
    el.style.cursor = 'grabbing';
    el.style.userSelect = 'none';
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const el = containerRef.current;
    if (!el) return;
    const x = e.pageX - el.offsetLeft;
    el.scrollLeft = scrollLeft - (x - startX);
  }, [dragging, startX, scrollLeft]);

  const onMouseUp = useCallback(() => {
    setDragging(false);
    const el = containerRef.current;
    if (el) {
      el.style.cursor = 'grab';
      el.style.userSelect = '';
    }
  }, []);

  if (goalsWithDeadline.length === 0) {
    return (
      <div className="border border-border bg-surface p-12 text-center">
        <p className="text-xs text-muted tracking-wide">
          Add goals with deadlines to see the timeline
        </p>
      </div>
    );
  }

  // Calculate time range: 30 days before earliest goal or today, 30 days after latest
  const now = new Date();
  const earliest = new Date(goalsWithDeadline[0].deadline!);
  const latest = new Date(goalsWithDeadline[goalsWithDeadline.length - 1].deadline!);
  const rangeStart = new Date(Math.min(now.getTime(), earliest.getTime()) - 30 * DAY_MS);
  const rangeEnd = new Date(Math.max(now.getTime(), latest.getTime()) + 60 * DAY_MS);
  const totalDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
  const totalWidth = totalDays * PX_PER_DAY;

  const todayOffset = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;

  // Generate month markers
  const months: { label: string; offset: number }[] = [];
  const cursor = new Date(rangeStart);
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() < rangeEnd.getTime()) {
    const offset = ((cursor.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
    months.push({ label: formatMonthYear(cursor), offset });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Generate week tick marks for bottom axis
  const weekTicks: { label: string; offset: number }[] = [];
  const tickCursor = new Date(rangeStart);
  tickCursor.setDate(tickCursor.getDate() + (7 - tickCursor.getDay()) % 7); // next Sunday
  while (tickCursor.getTime() < rangeEnd.getTime()) {
    const offset = ((tickCursor.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
    weekTicks.push({ label: formatDate(tickCursor), offset });
    tickCursor.setDate(tickCursor.getDate() + 7);
  }

  const trackHeight = goalsWithDeadline.length * (ROW_HEIGHT + ROW_GAP) + 16;

  // Unique categories present for legend
  const usedCategories = [...new Set(goalsWithDeadline.map((g) => categories[g.id]).filter(Boolean))];

  return (
    <div className="border border-border bg-surface rounded">
      {/* Legend */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border flex-wrap">
        <span className="text-[10px] text-muted uppercase tracking-widest font-mono">Categories</span>
        {usedCategories.map((cat) => {
          const color = CATEGORY_COLORS[cat] || DEFAULT_CATEGORY;
          return (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color.border }} />
              <span className="text-[10px] font-mono" style={{ color: color.label }}>{cat}</span>
            </div>
          );
        })}
      </div>

      {/* Scrollable timeline */}
      <div
        ref={containerRef}
        className="overflow-x-auto overflow-y-hidden relative"
        style={{ cursor: 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div style={{ width: totalWidth, minHeight: HEADER_HEIGHT + trackHeight + BOTTOM_AXIS }} className="relative">

          {/* Month labels at top */}
          {months.map((m, i) => (
            <div
              key={i}
              className="absolute top-0 text-[10px] font-mono text-muted/70"
              style={{ left: m.offset, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px` }}
            >
              <span className="pl-2">{m.label}</span>
              <div className="absolute top-0 bottom-0 w-px bg-border/40" style={{ left: 0 }} />
            </div>
          ))}

          {/* Today line */}
          <div
            className="absolute z-20"
            style={{
              left: todayOffset,
              top: 0,
              bottom: 0,
              width: 2,
              background: 'var(--color-accent)',
              opacity: 0.7,
            }}
          >
            <div
              className="absolute -top-0 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-wide"
              style={{
                background: 'var(--color-accent)',
                color: 'var(--color-bg)',
                whiteSpace: 'nowrap',
              }}
            >
              TODAY
            </div>
          </div>

          {/* Goal bars */}
          <div style={{ paddingTop: HEADER_HEIGHT + 8 }}>
            {goalsWithDeadline.map((goal, idx) => {
              const deadlineTime = new Date(goal.deadline!).getTime();
              const createdTime = new Date(goal.created_at).getTime();
              const startOffset = ((createdTime - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
              const endOffset = ((deadlineTime - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
              const barWidth = Math.max(endOffset - startOffset, 20);
              const progressWidth = (goal.progress / 100) * barWidth;

              const cat = categories[goal.id] || CATEGORY_KEYS[idx % CATEGORY_KEYS.length];
              const color = CATEGORY_COLORS[cat] || DEFAULT_CATEGORY;

              const top = idx * (ROW_HEIGHT + ROW_GAP);

              return (
                <div
                  key={goal.id}
                  className="absolute"
                  style={{ top: HEADER_HEIGHT + 8 + top, left: startOffset, height: ROW_HEIGHT }}
                  title={`${goal.title} — ${goal.progress}%`}
                >
                  {/* Label row */}
                  <div
                    className="text-[11px] font-mono whitespace-nowrap px-1 leading-tight"
                    style={{ color: color.label }}
                  >
                    {goal.title}
                    <span className="ml-1.5 text-[9px] opacity-50">{goal.progress}%</span>
                  </div>

                  {/* Bar row */}
                  <div className="relative mt-1" style={{ height: 16, width: barWidth }}>
                    {/* Track */}
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{ background: color.bg, border: `1px solid ${color.border}40` }}
                    />
                    {/* Progress fill */}
                    <div
                      className="absolute top-0 left-0 bottom-0 rounded-full"
                      style={{ width: progressWidth, background: color.border, opacity: 0.55 }}
                    />
                    {/* Deadline dot */}
                    <div
                      className="absolute w-3 h-3 rounded-full top-1/2"
                      style={{
                        right: -6,
                        transform: 'translateY(-50%)',
                        background: color.border,
                        border: '2px solid var(--color-surface)',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom date axis */}
          <div
            className="absolute left-0 right-0 border-t border-border/50"
            style={{ top: HEADER_HEIGHT + trackHeight + 8 }}
          >
            {weekTicks.map((tick, i) => (
              <div
                key={i}
                className="absolute text-[9px] font-mono text-muted/60"
                style={{ left: tick.offset, top: 4, transform: 'translateX(-50%)' }}
              >
                {tick.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
