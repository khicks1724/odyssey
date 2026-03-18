import { useRef, useState, useCallback, useEffect } from 'react';
import type { Goal } from '../types';
import './TimelinePage.css';

/* ─── Category colors ─── */
const CATEGORY_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  'Testing':    { bg: 'rgba(232,85,85,0.35)',    border: '#e85555', label: '#e85555' },
  'Seeker':     { bg: 'rgba(59,142,234,0.35)',   border: '#3b8eea', label: '#3b8eea' },
  'Missile':    { bg: 'rgba(232,162,53,0.35)',   border: '#e8a235', label: '#e8a235' },
  'Admin':      { bg: 'rgba(189,147,249,0.35)',  border: '#bd93f9', label: '#bd93f9' },
  'Simulation': { bg: 'rgba(82,201,142,0.35)',   border: '#52c98e', label: '#52c98e' },
};
const DEFAULT_CATEGORY = { bg: 'rgba(90,106,126,0.3)', border: '#5a6a7e', label: '#5a6a7e' };

const DAY_MS = 86_400_000;
const PX_PER_DAY = 40;
const ROW_H = 56;
const HEADER_H = 40;
const AXIS_H = 36;

function fmtDate(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtMonth(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }

function cv(vars: Record<string, string | number>): React.CSSProperties {
  return vars as unknown as React.CSSProperties;
}

function catColor(goal: Goal) {
  return CATEGORY_COLORS[goal.category ?? ''] ?? DEFAULT_CATEGORY;
}

interface TimelinePageProps { goals: Goal[]; projectName: string }

export default function TimelinePage({ goals }: TimelinePageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  const goalsWithDeadline = goals
    .filter((g) => g.deadline)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

  useEffect(() => {
    const el = containerRef.current;
    if (!el || goalsWithDeadline.length === 0) return;
    const now = new Date();
    const rangeStart = new Date(Math.min(now.getTime(), new Date(goalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS);
    el.scrollLeft = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY - el.clientWidth * 0.25;
  }, [goalsWithDeadline.length]);

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

  if (goalsWithDeadline.length === 0) {
    return <div className="tl-root border border-border bg-surface p-12 text-center flex-1"><p className="text-xs text-muted tracking-wide">Add goals with deadlines to see the timeline</p></div>;
  }

  const now = new Date();
  const rangeStart = new Date(Math.min(now.getTime(), new Date(goalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS);
  const rangeEnd   = new Date(Math.max(now.getTime(), new Date(goalsWithDeadline[goalsWithDeadline.length - 1].deadline!).getTime()) + 60 * DAY_MS);
  const totalDays  = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
  const totalWidth = totalDays * PX_PER_DAY;
  const todayOff   = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
  const trackH     = goalsWithDeadline.length * ROW_H;
  const canvasH    = HEADER_H + trackH + AXIS_H;

  const months: { label: string; x: number }[] = [];
  const mCur = new Date(rangeStart); mCur.setDate(1); mCur.setMonth(mCur.getMonth() + 1);
  while (mCur < rangeEnd) {
    months.push({ label: fmtMonth(mCur), x: ((mCur.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY });
    mCur.setMonth(mCur.getMonth() + 1);
  }

  const weekTicks: { label: string; x: number }[] = [];
  const wCur = new Date(rangeStart); wCur.setDate(wCur.getDate() + (7 - wCur.getDay()) % 7);
  while (wCur < rangeEnd) {
    weekTicks.push({ label: fmtDate(wCur), x: ((wCur.getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY });
    wCur.setDate(wCur.getDate() + 7);
  }

  // Unique categories present in this goal set (from goal.category field directly)
  const usedCategories = [...new Set(goalsWithDeadline.map((g) => g.category).filter(Boolean))] as string[];

  return (
    <div className="tl-root border border-border bg-surface flex flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-border flex-wrap shrink-0">
        <span className="text-[10px] text-muted uppercase tracking-widest font-mono">Categories</span>
        {usedCategories.map((cat) => {
          const c = CATEGORY_COLORS[cat] ?? DEFAULT_CATEGORY;
          return (
            <div key={cat} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={cv({ background: c.border })} />
              <span className="text-[10px] font-mono" style={cv({ color: c.label })}>{cat}</span>
            </div>
          );
        })}
      </div>

      {/* Body: fixed label col + scrollable chart */}
      <div className="flex flex-1 overflow-hidden">

        {/* Label column */}
        <div className="tl-label-col shrink-0 border-r border-border bg-surface flex flex-col">
          <div className="tl-header-row border-b border-border/40" />
          {goalsWithDeadline.map((goal) => {
            const c = catColor(goal);
            return (
              <div key={goal.id} className="tl-row flex items-center px-3 gap-2 border-b border-border/30">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={cv({ background: c.border })} />
                <span className="text-[11px] font-mono truncate leading-tight" style={cv({ color: c.label })} title={goal.title}>
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
          <div className="tl-canvas" style={cv({ '--tl-w': `${totalWidth}px`, '--tl-min-h': `${canvasH}px` })}>

            {/* Day grid lines */}
            {Array.from({ length: totalDays + 1 }, (_, d) => {
              const date = new Date(rangeStart.getTime() + d * DAY_MS);
              const isMonday  = date.getDay() === 1;
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              const bg = isMonday ? 'var(--color-border)' : isWeekend ? 'rgba(150,150,150,0.22)' : 'rgba(150,150,150,0.1)';
              return <div key={d} className="tl-day-line" style={cv({ '--tl-left': `${d * PX_PER_DAY}px`, '--tl-bg': bg })} />;
            })}

            {/* Weekend shading */}
            {Array.from({ length: totalDays }, (_, d) => {
              const date = new Date(rangeStart.getTime() + d * DAY_MS);
              if (date.getDay() !== 0 && date.getDay() !== 6) return null;
              return <div key={`w${d}`} className="tl-wknd-shade" style={cv({ '--tl-left': `${d * PX_PER_DAY}px`, '--tl-h': `${trackH}px` })} />;
            })}

            {/* Row dividers */}
            {goalsWithDeadline.map((_, idx) => (
              <div key={`rd${idx}`} className="tl-row-div" style={cv({ '--tl-top': `${HEADER_H + idx * ROW_H}px` })} />
            ))}

            {/* Month labels */}
            <div className="tl-header-row absolute left-0 right-0 top-0 border-b border-border/40" style={{ zIndex: 5 }}>
              {months.map((m, i) => (
                <div key={i} className="tl-month-lbl text-[10px] font-mono text-muted/70" style={cv({ '--tl-left': `${m.x + 4}px` })}>
                  {m.label}
                </div>
              ))}
            </div>

            {/* Today line */}
            <div className="tl-today-line" style={cv({ '--tl-left': `${todayOff}px` })}>
              <div className="absolute left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-[9px] font-mono font-bold tracking-wide"
                style={cv({ top: '4px', background: 'var(--color-accent)', color: 'var(--color-bg)', whiteSpace: 'nowrap' })}>
                TODAY
              </div>
            </div>

            {/* Goal bars */}
            {goalsWithDeadline.map((goal, idx) => {
              const deadlineOff = ((new Date(goal.deadline!).getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY;
              const createdOff  = Math.max(0, ((new Date(goal.created_at).getTime() - rangeStart.getTime()) / DAY_MS) * PX_PER_DAY);
              const barW        = Math.max(deadlineOff - createdOff, 24);
              const fillW       = (goal.progress / 100) * barW;
              const barTop      = HEADER_H + idx * ROW_H + (ROW_H - 18) / 2;
              const c           = catColor(goal);

              return (
                <div key={goal.id} className="tl-bar-wrap" style={cv({ '--tl-top': `${barTop}px`, '--tl-left': `${createdOff}px`, '--tl-w': `${barW}px` })} title={`${goal.title} — ${goal.progress}%`}>
                  <div className="tl-bar-track" style={cv({ '--tl-bg': c.bg, '--tl-border': `${c.border}40` })} />
                  <div className="tl-bar-fill"  style={cv({ '--tl-bg': c.border, '--tl-w': `${fillW}px` })} />
                  <div className="tl-bar-dot"   style={cv({ '--tl-bg': c.border })} />
                </div>
              );
            })}

            {/* Bottom axis */}
            <div className="tl-axis-bot border-t border-border/50" style={cv({ '--tl-top': `${HEADER_H + trackH}px` })}>
              {weekTicks.map((tick, i) => (
                <div key={i} className="tl-tick text-[9px] font-mono text-muted/60" style={cv({ '--tl-left': `${tick.x}px` })}>
                  {tick.label}
                </div>
              ))}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
