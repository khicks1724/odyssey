import { useRef, useState, useCallback, useEffect } from 'react';
import type { Goal } from '../types';
import './TimelinePage.css';
import './Timeline.css';
import CalendarView from './CalendarView';
import { Clock, CalendarDays } from 'lucide-react';

/* ─── Category colors ─── */
const CATEGORY_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  'Testing':    { bg: 'rgba(232,85,85,0.35)',    border: '#e85555', label: '#e85555' },
  'Seeker':     { bg: 'rgba(59,142,234,0.35)',   border: '#3b8eea', label: '#3b8eea' },
  'Missile':    { bg: 'rgba(232,162,53,0.35)',   border: '#e8a235', label: '#e8a235' },
  'Admin':      { bg: 'rgba(189,147,249,0.35)',  border: '#bd93f9', label: '#bd93f9' },
  'Simulation': { bg: 'rgba(82,201,142,0.35)',   border: '#52c98e', label: '#52c98e' },
  'DevOps':     { bg: 'rgba(220,112,112,0.35)',  border: '#dc7070', label: '#dc7070' },
};
const DEFAULT_CATEGORY = { bg: 'rgba(90,106,126,0.3)', border: '#5a6a7e', label: '#5a6a7e' };

const DAY_MS = 86_400_000;
const ROW_H = 36;
const SECTION_H = 22;
const HEADER_H = 40;
const AXIS_H = 36;
const MIN_PPD = 8;
const MAX_PPD = 140;
const CATEGORY_KEY_ORDER = Object.keys(CATEGORY_COLORS);

function fmtDate(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtMonth(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }

function cv(vars: Record<string, string | number>): React.CSSProperties {
  return vars as unknown as React.CSSProperties;
}

function catColor(goal: Goal) {
  return CATEGORY_COLORS[goal.category ?? ''] ?? DEFAULT_CATEGORY;
}

interface MemberInfo { user_id: string; display_name: string | null; }
interface HoverState { id: string; y: number; }

function GoalTooltip({ goal, members, y }: { goal: Goal; members: MemberInfo[]; y: number }) {
  const c = catColor(goal);
  const assigneeIds: string[] = goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []);
  const assigneeNames = assigneeIds.map((id) => members.find((m) => m.user_id === id)?.display_name ?? 'Unknown');
  const statusLabels: Record<string, string> = {
    not_started: 'Not Started', in_progress: 'In Progress', in_review: 'In Review', complete: 'Complete',
  };

  const style = cv({ '--tlo-color': c.border, top: `${y}px`, left: '190px', transform: 'translateY(-50%)' });

  return (
    <div className="tlo-tooltip tl-tooltip-fixed" {...({ style } as any)}>
      <div className="tlo-tooltip-bar" />
      <div className="tlo-tooltip-body">
        <p className="text-xs font-mono font-semibold text-heading leading-snug mb-2">{goal.title}</p>
        <div className="space-y-1">
          <div className="flex justify-between gap-4">
            <span className="text-[10px] text-muted">Status</span>
            <span className="text-[10px] font-mono text-heading">{statusLabels[goal.status] ?? goal.status}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[10px] text-muted">Progress</span>
            <span className="text-[10px] font-mono text-heading">{goal.progress}%</span>
          </div>
          {goal.deadline && (
            <div className="flex justify-between gap-4">
              <span className="text-[10px] text-muted">Due</span>
              <span className="text-[10px] font-mono text-heading">
                {new Date(goal.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>
          )}
          {goal.category && (
            <div className="flex justify-between gap-4">
              <span className="text-[10px] text-muted">Category</span>
              <span className="text-[10px] font-mono tlo-cat-text">{goal.category}</span>
            </div>
          )}
          {goal.loe && (
            <div className="flex justify-between gap-4">
              <span className="text-[10px] text-muted">LOE</span>
              <span className="text-[10px] font-mono text-heading">{goal.loe}</span>
            </div>
          )}
          {assigneeNames.length > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-[10px] text-muted">Assigned to</span>
              <span className="text-[10px] font-mono text-heading text-right">{assigneeNames.join(', ')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TimelinePageProps {
  goals: Goal[];
  projectName: string;
  members?: MemberInfo[];
  projectId?: string;
  onGoalClick?: (goal: Goal) => void;
  onCreateGoalForDate?: (dateStr: string) => void;
}

export default function TimelinePage({ goals, members = [], projectId = '', onGoalClick, onCreateGoalForDate }: TimelinePageProps) {
  const [view, setView] = useState<'timeline' | 'calendar'>('timeline');
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pxPerDay, setPxPerDay] = useState(40);

  const goalsWithDeadline = goals
    .filter((g) => g.deadline)
    .sort((a, b) => {
      const ai = CATEGORY_KEY_ORDER.indexOf(a.category ?? '');
      const bi = CATEGORY_KEY_ORDER.indexOf(b.category ?? '');
      const catDiff = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      if (catDiff !== 0) return catDiff;
      return new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime();
    });

  // Scroll to today on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el || goalsWithDeadline.length === 0) return;
    const now = new Date();
    const rangeStart = new Date(Math.min(now.getTime(), new Date(goalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS);
    el.scrollLeft = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay - el.clientWidth * 0.25;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalsWithDeadline.length]);

  // Scroll-wheel zoom — zoom toward cursor position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // only zoom when Ctrl/Cmd held
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + el.scrollLeft; // px from canvas left
      setPxPerDay((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.min(MAX_PPD, Math.max(MIN_PPD, prev * factor));
        // Adjust scroll so the point under cursor stays fixed
        requestAnimationFrame(() => {
          if (el) el.scrollLeft = (cursorX / prev) * next - (e.clientX - rect.left);
        });
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current; if (!el) return;
    setDragging(true); setStartX(e.pageX - el.offsetLeft); setScrollLeft(el.scrollLeft);
    el.style.cursor = 'grabbing'; el.style.userSelect = 'none';
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const el = containerRef.current; if (!el) return;
    el.scrollLeft = scrollLeft - (e.pageX - el.offsetLeft - startX);
  }, [dragging, startX, scrollLeft]);
  const onMouseUp = useCallback(() => {
    setDragging(false);
    const el = containerRef.current;
    if (el) { el.style.cursor = 'grab'; el.style.userSelect = ''; }
  }, []);

  // Calendar view — always renderable regardless of deadlines
  if (view === 'calendar') {
    return (
      <div className="tl-cal-wrap flex flex-col">
        {/* View toggle strip */}
        <div className="flex items-center gap-1 px-4 py-2 border border-border bg-surface rounded-t-lg border-b-0 shrink-0">
          <span className="text-[10px] text-muted uppercase tracking-widest font-mono mr-2">View</span>
          <button type="button" onClick={() => setView('timeline')}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-mono text-muted hover:text-heading hover:bg-surface2 transition-colors">
            <Clock size={12} /> Timeline
          </button>
          <button type="button" onClick={() => setView('calendar')}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-mono bg-surface2 text-heading transition-colors">
            <CalendarDays size={12} /> Calendar
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <CalendarView
            goals={goals}
            members={members}
            projectId={projectId}
            onGoalClick={onGoalClick ?? (() => {})}
            onCreateGoalForDate={onCreateGoalForDate ?? (() => {})}
          />
        </div>
      </div>
    );
  }

  if (goalsWithDeadline.length === 0) {
    return <div className="tl-root border border-border bg-surface p-12 text-center flex-1"><p className="text-xs text-muted tracking-wide">Add goals with deadlines to see the timeline</p></div>;
  }

  const now = new Date();
  const rangeStart = new Date(Math.min(now.getTime(), new Date(goalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS);
  const rangeEnd   = new Date(Math.max(now.getTime(), new Date(goalsWithDeadline[goalsWithDeadline.length - 1].deadline!).getTime()) + 60 * DAY_MS);
  const totalDays  = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
  const totalWidth = totalDays * pxPerDay;
  const todayOff   = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay;

  // Build grouped rows (section headers + goal rows)
  type SectionRow = { type: 'section'; category: string; top: number };
  type GoalRow    = { type: 'goal'; goal: Goal; top: number };
  const groupedRows: Array<SectionRow | GoalRow> = [];
  let curTop = 0;
  let curCat: string | undefined = undefined;
  for (const goal of goalsWithDeadline) {
    const cat = goal.category ?? '';
    if (cat !== curCat) {
      groupedRows.push({ type: 'section', category: cat || 'Uncategorized', top: curTop });
      curTop += SECTION_H;
      curCat = cat;
    }
    groupedRows.push({ type: 'goal', goal, top: curTop });
    curTop += ROW_H;
  }
  const trackH  = curTop;
  const canvasH = HEADER_H + trackH + AXIS_H;

  const months: { label: string; x: number }[] = [];
  const mCur = new Date(rangeStart); mCur.setDate(1); mCur.setMonth(mCur.getMonth() + 1);
  while (mCur < rangeEnd) {
    months.push({ label: fmtMonth(mCur), x: ((mCur.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay });
    mCur.setMonth(mCur.getMonth() + 1);
  }

  const weekTicks: { label: string; x: number }[] = [];
  const wCur = new Date(rangeStart); wCur.setDate(wCur.getDate() + (7 - wCur.getDay()) % 7);
  while (wCur < rangeEnd) {
    weekTicks.push({ label: fmtDate(wCur), x: ((wCur.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay });
    wCur.setDate(wCur.getDate() + 7);
  }

  const usedCatSet = new Set(goalsWithDeadline.map((g) => g.category).filter(Boolean)) as Set<string>;
  const usedCategories = CATEGORY_KEY_ORDER.filter((c) => usedCatSet.has(c));
  const hoveredGoal = hovered ? goalsWithDeadline.find((g) => g.id === hovered.id) : null;

  return (
    <div className="tl-root border border-border bg-surface flex flex-col">
      {/* Legend + view toggle + zoom hint */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border flex-wrap shrink-0">
        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-surface2 rounded p-0.5 shrink-0">
          <button type="button" onClick={() => setView('timeline')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono bg-surface text-heading shadow-sm transition-colors">
            <Clock size={11} /> Timeline
          </button>
          <button type="button" onClick={() => setView('calendar')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono text-muted hover:text-heading transition-colors">
            <CalendarDays size={11} /> Calendar
          </button>
        </div>
        <span className="text-[10px] text-muted uppercase tracking-widest font-mono">Categories</span>
        {usedCategories.map((cat) => {
          const c = CATEGORY_COLORS[cat] ?? DEFAULT_CATEGORY;
          return (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="tl-cat-swatch" {...({ style: cv({ '--tl-cat': c.border }) } as any)} />
              <span className="text-[10px] font-mono tl-cat-label" {...({ style: cv({ '--tl-cat-label': c.label }) } as any)}>{cat}</span>
            </div>
          );
        })}
        <span className="ml-auto text-[9px] text-muted/50 font-mono">Ctrl + scroll to zoom</span>
      </div>

      {/* Body: fixed label col + scrollable chart */}
      <div className="flex flex-1 overflow-hidden">

        {/* Label column */}
        <div className="tl-label-col shrink-0 border-r border-border bg-surface flex flex-col">
          <div className="tl-header-row border-b border-border/40" />
          {groupedRows.map((row, i) => {
            if (row.type === 'section') {
              const c = CATEGORY_COLORS[row.category] ?? DEFAULT_CATEGORY;
              return (
                <div
                  key={`sec-${i}`}
                  className="tl-section-row"
                  {...({ style: cv({ '--tl-cat': c.border, '--tl-cat-label': c.label }) } as any)}
                >
                  <span className="tl-section-dot" />
                  <span className="tl-section-lbl">{row.category}</span>
                </div>
              );
            }
            const { goal } = row;
            const c = catColor(goal);
            return (
              <div
                key={goal.id}
                className={`tl-row tl-label-hover flex items-center px-3 gap-2 border-b border-border/30 ${onGoalClick ? 'cursor-pointer' : ''}`}
                {...({ style: cv({ '--tl-cat': c.border, '--tl-cat-label': c.label }) } as any)}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHovered({ id: goal.id, y: rect.top + rect.height / 2 });
                }}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onGoalClick?.(goal)}
              >
                <span className="tl-label-dot shrink-0" />
                <span className="text-[11px] font-mono truncate leading-tight tl-label-text" title={goal.title}>
                  {goal.title}
                </span>
              </div>
            );
          })}
          <div className="tl-axis border-t border-border/50" />
        </div>

        {/* Scrollable chart */}
        <div
          ref={containerRef}
          className="tl-scroll flex-1 overflow-x-auto overflow-y-hidden relative"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <div className="tl-canvas" {...({ style: cv({ '--tl-w': `${totalWidth}px`, '--tl-min-h': `${canvasH}px` }) } as any)}>

            {/* Day grid lines */}
            {Array.from({ length: totalDays + 1 }, (_, d) => {
              const date = new Date(rangeStart.getTime() + d * DAY_MS);
              const isMonday  = date.getDay() === 1;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const bg = isMonday ? 'var(--color-border)' : isWeekend ? 'rgba(150,150,150,0.22)' : 'rgba(150,150,150,0.1)';
              return <div key={d} className="tl-day-line" {...({ style: cv({ '--tl-left': `${d * pxPerDay}px`, '--tl-bg': bg }) } as any)} />;
            })}

            {/* Weekend shading */}
            {Array.from({ length: totalDays }, (_, d) => {
              const date = new Date(rangeStart.getTime() + d * DAY_MS);
              if (date.getDay() !== 0 && date.getDay() !== 6) return null;
              return <div key={`w${d}`} className="tl-wknd-shade" {...({ style: cv({ '--tl-left': `${d * pxPerDay}px`, '--tl-h': `${trackH}px` }) } as any)} />;
            })}

            {/* Row dividers + section shading */}
            {groupedRows.map((row, i) => (
              row.type === 'section'
                ? <div key={`sd${i}`} className="tl-section-div" {...({ style: cv({ '--tl-top': `${HEADER_H + row.top}px` }) } as any)} />
                : <div key={`rd${i}`} className="tl-row-div"     {...({ style: cv({ '--tl-top': `${HEADER_H + row.top}px` }) } as any)} />
            ))}

            {/* Month labels */}
            <div className="tl-header-row tl-month-header absolute left-0 right-0 top-0 border-b border-border/40">
              {months.map((m, i) => (
                <div key={i} className="tl-month-lbl text-[10px] font-mono text-muted/70" {...({ style: cv({ '--tl-left': `${m.x + 4}px` }) } as any)}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* Today line */}
            <div className="tl-today-line" {...({ style: cv({ '--tl-left': `${todayOff}px` }) } as any)}>
              <div className="tl-today-label text-[9px] font-mono font-bold tracking-wide">
                {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </div>
            </div>

            {/* Goal bars */}
            {groupedRows.filter((r): r is GoalRow => r.type === 'goal').map((row) => {
              const { goal } = row;
              const deadlineOff = ((new Date(goal.deadline!).getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay;
              const createdOff  = Math.max(0, ((new Date(goal.created_at).getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay);
              const barW        = Math.max(deadlineOff - createdOff, 24);
              const fillW       = (goal.progress / 100) * barW;
              const barTop      = HEADER_H + row.top + (ROW_H - 18) / 2;
              const c           = catColor(goal);

              return (
                <div key={goal.id} className={`tl-bar-wrap ${onGoalClick ? 'cursor-pointer' : ''}`} {...({ style: cv({ '--tl-top': `${barTop}px`, '--tl-left': `${createdOff}px`, '--tl-w': `${barW}px` }) } as any)} title={`${goal.title} — ${goal.progress}%`} onClick={() => onGoalClick?.(goal)}>
                  <div className="tl-bar-track" {...({ style: cv({ '--tl-bg': c.bg, '--tl-border': `${c.border}40` }) } as any)} />
                  <div className="tl-bar-fill"  {...({ style: cv({ '--tl-bg': c.border, '--tl-w': `${fillW}px` }) } as any)} />
                  <div className="tl-bar-dot"   {...({ style: cv({ '--tl-bg': c.border }) } as any)} />
                </div>
              );
            })}

            {/* Bottom axis */}
            <div className="tl-axis-bot border-t border-border/50" {...({ style: cv({ '--tl-top': `${HEADER_H + trackH}px` }) } as any)}>
              {weekTicks.map((tick, i) => (
                <div key={i} className="tl-tick text-[9px] font-mono text-muted/60" {...({ style: cv({ '--tl-left': `${tick.x}px` }) } as any)}>
                  {tick.label}
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>

      {/* Fixed-position tooltip — renders outside overflow:hidden so it never clips */}
      {hovered && hoveredGoal && (
        <GoalTooltip goal={hoveredGoal} members={members} y={hovered.y} />
      )}
    </div>
  );
}
