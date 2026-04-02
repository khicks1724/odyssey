import { useRef, useState, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { Goal } from '../types';
import './TimelinePage.css';
import './Timeline.css';
import CalendarView from './CalendarView';
import { Clock, CalendarDays, Plus, X, Layers } from 'lucide-react';

type GroupBy = 'category';

const DEFAULT_CATEGORY = { bg: 'rgba(90,106,126,0.3)', border: '#5a6a7e', label: '#5a6a7e' };

/* ─── Rotating palette for category grouping ─── */
const GROUP_PALETTE: { bg: string; border: string; label: string }[] = [
  { bg: 'rgba(59,142,234,0.35)',  border: '#3b8eea', label: '#3b8eea' },
  { bg: 'rgba(82,201,142,0.35)', border: '#52c98e', label: '#52c98e' },
  { bg: 'rgba(232,162,53,0.35)', border: '#e8a235', label: '#e8a235' },
  { bg: 'rgba(189,147,249,0.35)',border: '#bd93f9', label: '#bd93f9' },
  { bg: 'rgba(232,85,85,0.35)',  border: '#e85555', label: '#e85555' },
  { bg: 'rgba(139,233,253,0.35)',border: '#8be9fd', label: '#8be9fd' },
  { bg: 'rgba(255,184,108,0.35)',border: '#ffb86c', label: '#ffb86c' },
  { bg: 'rgba(220,112,112,0.35)',border: '#dc7070', label: '#dc7070' },
];

function makeGroupColorMap(keys: string[]): Map<string, { bg: string; border: string; label: string }> {
  const map = new Map<string, { bg: string; border: string; label: string }>();
  keys.forEach((k, i) => map.set(k, GROUP_PALETTE[i % GROUP_PALETTE.length]));
  return map;
}

const DAY_MS    = 86_400_000;
const ROW_H     = 36;
const SECTION_H = 22;
const SPRINT_H  = 26;  // height per sprint row
const MONTH_H   = 24;  // month label row
const DAY_H     = 20;  // day-number row
const AXIS_H    = 36;
const MIN_PPD   = 8;
const MAX_PPD   = 140;

function fmtDate(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function fmtMonth(d: Date) { return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); }

function cv(vars: Record<string, string | number>): React.CSSProperties {
  return vars as unknown as React.CSSProperties;
}

interface Sprint {
  id: string;
  name: string;
  type: 'sprint' | 'phase';
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
}

/** Greedy interval packing — returns rows, each row a list of non-overlapping sprints */
function packSprints(sprints: Sprint[]): Sprint[][] {
  const rows: Sprint[][] = [];
  const sorted = [...sprints].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (const s of sorted) {
    let placed = false;
    for (const row of rows) {
      if (row[row.length - 1].end_date < s.start_date) {
        row.push(s);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([s]);
  }
  return rows;
}

interface MemberInfo { user_id: string; display_name: string | null; }
interface HoverState  { id: string; y: number; }

function getGoalGroupKey(goal: Goal, groupBy: GroupBy, members: MemberInfo[]): string {
  if (groupBy === 'category') return goal.category ?? '';
  if (groupBy === 'loe') return goal.loe ?? '';
  const ids = goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []);
  if (ids.length === 0) return '';
  return members.find((m) => m.user_id === ids[0])?.display_name ?? ids[0] ?? '';
}

function GoalTooltip({ goal, members, y, color }: {
  goal: Goal;
  members: MemberInfo[];
  y: number;
  color: { bg: string; border: string; label: string };
}) {
  const assigneeIds: string[] = goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []);
  const assigneeNames = assigneeIds.map((id) => members.find((m) => m.user_id === id)?.display_name ?? 'Unknown');
  const statusLabels: Record<string, string> = {
    not_started: 'Not Started', in_progress: 'In Progress', in_review: 'In Review', complete: 'Complete',
  };
  const style = cv({ '--tlo-color': color.border, top: `${y}px`, left: '190px', transform: 'translateY(-50%)' });
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
  projectCategories?: string[];
  projectLoes?: string[];
}

export default function TimelinePage({
  goals, members = [], projectId = '', onGoalClick, onCreateGoalForDate,
  projectCategories = [], projectLoes = [],
}: TimelinePageProps) {
  const [view, setView] = useState<'timeline' | 'calendar'>('timeline');
  const groupBy: GroupBy = 'category';
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<HoverState | null>(null);
  const [startX, setStartX] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [pxPerDay, setPxPerDay] = useState(40);

  const [filterCategory, setFilterCategory] = useState('');
  const [filterLoe, setFilterLoe] = useState('');

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [showSprintForm, setShowSprintForm] = useState(false);
  const [sprintForm, setSprintForm] = useState<{ name: string; type: 'sprint' | 'phase'; start_date: string; end_date: string }>(
    { name: '', type: 'sprint', start_date: '', end_date: '' }
  );

  /* ── Load sprints ── */
  useEffect(() => {
    if (!projectId) return;
    supabase
      .from('time_periods')
      .select('id, name, type, start_date, end_date')
      .eq('project_id', projectId)
      .order('start_date')
      .then(({ data }) => { if (data) setSprints(data as Sprint[]); });
  }, [projectId]);

  const createSprint = async () => {
    if (!sprintForm.name.trim() || !sprintForm.start_date || !sprintForm.end_date || !projectId) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id ?? null;
    const { data, error } = await supabase
      .from('time_periods')
      .insert({
        project_id: projectId,
        name: sprintForm.name.trim(),
        type: sprintForm.type,
        start_date: sprintForm.start_date,
        end_date: sprintForm.end_date,
        created_by: userId,
      })
      .select('id, name, type, start_date, end_date')
      .single();
    if (!error && data) {
      setSprints((prev) => [...prev, data as Sprint].sort((a, b) => a.start_date.localeCompare(b.start_date)));
      setSprintForm({ name: '', type: 'sprint', start_date: '', end_date: '' });
      setShowSprintForm(false);
    }
  };

  const deleteSprint = async (id: string) => {
    await supabase.from('time_periods').delete().eq('id', id);
    setSprints((prev) => prev.filter((s) => s.id !== id));
  };

  /* ── Filtered + sorted goals ── */
  const goalsWithDeadline = goals
    .filter((g) => g.deadline)
    .filter((g) => !filterCategory || g.category === filterCategory)
    .filter((g) => !filterLoe || g.loe === filterLoe)
    .sort((a, b) => {
      const ak = getGoalGroupKey(a, groupBy, members);
      const bk = getGoalGroupKey(b, groupBy, members);
      const kDiff = ak.localeCompare(bk);
      if (kDiff !== 0) return kDiff;
      return new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime();
    });

  /* ── All goals with deadlines (unfiltered) for stable range ── */
  const allGoalsWithDeadline = goals
    .filter((g) => g.deadline)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

  /* ── Scroll to today on mount ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || allGoalsWithDeadline.length === 0) return;
    const now = new Date();
    const rangeStart = new Date(
      Math.min(now.getTime(), new Date(allGoalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS
    );
    el.scrollLeft = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay - el.clientWidth * 0.25;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allGoalsWithDeadline.length]);

  /* ── Ctrl+scroll zoom ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left + el.scrollLeft;
      setPxPerDay((prev) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const next = Math.min(MAX_PPD, Math.max(MIN_PPD, prev * factor));
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

  /* ── Select filter styles ── */
  const selCls = (active: boolean) =>
    `text-[10px] font-mono px-2 py-1 rounded border bg-surface2 transition-colors outline-none cursor-pointer h-[30px] ${active ? 'border-accent text-heading' : 'border-border text-muted'}`;

  /* ─────── Calendar view ─────── */
  if (view === 'calendar') {
    return (
      <div className="tl-cal-wrap flex flex-col">
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

  /* ─────── No goals at all ─────── */
  if (allGoalsWithDeadline.length === 0) {
    return (
      <div className="tl-root border border-border bg-surface p-12 text-center flex-1">
        <p className="text-xs text-muted tracking-wide">Add goals with deadlines to see the timeline</p>
      </div>
    );
  }

  /* ─────── Chart geometry ─────── */
  const now        = new Date();
  const rangeStart = new Date(Math.min(now.getTime(), new Date(allGoalsWithDeadline[0].deadline!).getTime()) - 30 * DAY_MS);
  const rangeEnd   = new Date(Math.max(now.getTime(), new Date(allGoalsWithDeadline[allGoalsWithDeadline.length - 1].deadline!).getTime()) + 60 * DAY_MS);
  const totalDays  = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
  const totalWidth = totalDays * pxPerDay;
  const todayOff   = ((now.getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay;

  /* ─── Sprint rows ─── */
  const sprintRows  = packSprints(sprints);
  const sprintAreaH = sprintRows.length * SPRINT_H;
  const headerH     = sprintAreaH + MONTH_H + DAY_H;

  /* ─── Group color map ─── */
  const uniqueGroupKeys  = [...new Set(goalsWithDeadline.map((g) => getGoalGroupKey(g, groupBy, members)))];
  const groupColorMap    = makeGroupColorMap(uniqueGroupKeys);

  function goalColor(goal: Goal) {
    return groupColorMap.get(getGoalGroupKey(goal, groupBy, members)) ?? DEFAULT_CATEGORY;
  }

  /* ─── Grouped rows ─── */
  type SectionRow = { type: 'section'; label: string; colorKey: string; top: number };
  type GoalRow    = { type: 'goal'; goal: Goal; top: number };
  const groupedRows: Array<SectionRow | GoalRow> = [];
  let curTop = 0;
  let curGroupKey: string | undefined = undefined;
  for (const goal of goalsWithDeadline) {
    const key = getGoalGroupKey(goal, groupBy, members);
    if (key !== curGroupKey) {
      groupedRows.push({ type: 'section', label: key || 'Uncategorized', colorKey: key, top: curTop });
      curTop += SECTION_H;
      curGroupKey = key;
    }
    groupedRows.push({ type: 'goal', goal, top: curTop });
    curTop += ROW_H;
  }
  const trackH  = curTop;
  const canvasH = headerH + trackH + AXIS_H;

  /* ─── Month + week tick marks ─── */
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

  const hoveredGoal  = hovered ? goalsWithDeadline.find((g) => g.id === hovered.id) : null;
  const hoveredColor = hoveredGoal ? goalColor(hoveredGoal) : DEFAULT_CATEGORY;

  return (
    <div className="tl-root border border-border bg-surface flex flex-col">

      {/* ── Toolbar: view toggle + filters + legend + sprint button ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border flex-wrap shrink-0">
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

        {/* Category filter */}
        {projectCategories.length > 0 && (
          <select title="Filter by category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selCls(!!filterCategory)}>
            <option value="">All Categories</option>
            {projectCategories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* LOE filter */}
        {projectLoes.length > 0 && (
          <select title="Filter by line of effort" value={filterLoe} onChange={(e) => setFilterLoe(e.target.value)} className={`${selCls(!!filterLoe)} min-w-[11rem]`}>
            <option value="">All Lines of Effort</option>
            {projectLoes.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}

        {/* Clear filters */}
        {(filterCategory || filterLoe) && (
          <button type="button" onClick={() => { setFilterCategory(''); setFilterLoe(''); }}
            className="text-[10px] font-mono px-2 py-1 border border-border rounded text-muted hover:text-heading hover:bg-surface2 transition-colors h-[30px]">
            Clear
          </button>
        )}

        {/* Category color legend */}
        {uniqueGroupKeys.map((key) => {
          const c = groupColorMap.get(key) ?? DEFAULT_CATEGORY;
          return (
            <div key={key || '__empty'} className="flex items-center gap-1.5">
              <span className="tl-cat-swatch" {...({ style: cv({ '--tl-cat': c.border }) } as any)} />
              <span className="text-[10px] font-mono tl-cat-label" {...({ style: cv({ '--tl-cat-label': c.label }) } as any)}>
                {key || 'Uncategorized'}
              </span>
            </div>
          );
        })}

        {/* Right side: sprint button + zoom hint */}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSprintForm((v) => !v)}
            className={`flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 border rounded transition-colors h-[30px] ${
              showSprintForm ? 'border-accent text-heading bg-surface2' : 'border-border text-muted hover:text-heading hover:bg-surface2'
            }`}
          >
            <Layers size={10} /> Sprints <Plus size={9} />
          </button>
          <span className="text-[9px] text-muted/50 font-mono">Ctrl + scroll to zoom</span>
        </div>
      </div>

      {/* ── Sprint creation form ── */}
      {showSprintForm && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-surface2/20 flex-wrap shrink-0">
          <span className="text-[9px] font-mono text-muted/70 uppercase tracking-widest">New Period</span>
          <input
            type="text"
            placeholder="Name (e.g. Sprint 1)"
            value={sprintForm.name}
            onChange={(e) => setSprintForm((p) => ({ ...p, name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') createSprint(); if (e.key === 'Escape') setShowSprintForm(false); }}
            className="text-[10px] font-mono px-2 py-1 border border-border rounded bg-surface text-heading placeholder:text-muted/40 focus:outline-none focus:border-accent/50 h-[26px] w-40"
          />
          <select
            title="Period type"
            value={sprintForm.type}
            onChange={(e) => setSprintForm((p) => ({ ...p, type: e.target.value as 'sprint' | 'phase' }))}
            className="text-[10px] font-mono px-2 py-1 border border-border rounded bg-surface text-muted focus:outline-none cursor-pointer h-[26px]"
          >
            <option value="sprint">Sprint</option>
            <option value="phase">Phase</option>
          </select>
          <input
            type="date"
            title="Start date"
            value={sprintForm.start_date}
            onChange={(e) => setSprintForm((p) => ({ ...p, start_date: e.target.value }))}
            className="text-[10px] font-mono px-2 py-1 border border-border rounded bg-surface text-heading focus:outline-none focus:border-accent/50 h-[26px]"
          />
          <span className="text-[9px] text-muted font-mono">→</span>
          <input
            type="date"
            title="End date"
            value={sprintForm.end_date}
            onChange={(e) => setSprintForm((p) => ({ ...p, end_date: e.target.value }))}
            className="text-[10px] font-mono px-2 py-1 border border-border rounded bg-surface text-heading focus:outline-none focus:border-accent/50 h-[26px]"
          />
          <button
            type="button"
            onClick={createSprint}
            disabled={!sprintForm.name.trim() || !sprintForm.start_date || !sprintForm.end_date}
            className="text-[10px] font-mono px-3 py-1 bg-accent text-white rounded hover:opacity-90 disabled:opacity-40 transition-opacity h-[26px]"
          >
            Add
          </button>
          <button
            type="button"
            title="Cancel"
            onClick={() => setShowSprintForm(false)}
            className="flex items-center justify-center text-[10px] font-mono px-2 py-1 border border-border rounded text-muted hover:text-heading hover:bg-surface2 transition-colors h-[26px]"
          >
            <X size={10} />
          </button>
        </div>
      )}

      {/* ── Empty filter state ── */}
      {goalsWithDeadline.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-12">
          <p className="text-xs text-muted tracking-wide">No tasks match the selected filters</p>
        </div>
      )}

      {/* ── Chart body ── */}
      {goalsWithDeadline.length > 0 && (
        <div className="flex flex-1 overflow-hidden">

          {/* Label column */}
          <div className="tl-label-col shrink-0 border-r border-border bg-surface flex flex-col">
            {/* Header spacer — height driven by --tl-h CSS var */}
            <div className="tl-header-row" {...({ style: cv({ '--tl-h': `${headerH}px` }) } as any)}>
              {sprintAreaH > 0 && (
                <div className="tl-sprint-label-row" {...({ style: cv({ '--tl-h': `${sprintAreaH}px` }) } as any)}>
                  <span className="text-[8px] font-mono text-muted/50 uppercase tracking-widest">Phases</span>
                </div>
              )}
            </div>

            {groupedRows.map((row, i) => {
              if (row.type === 'section') {
                const c = groupColorMap.get(row.colorKey) ?? DEFAULT_CATEGORY;
                return (
                  <div key={`sec-${i}`} className="tl-section-row"
                    {...({ style: cv({ '--tl-cat': c.border, '--tl-cat-label': c.label }) } as any)}>
                    <span className="tl-section-dot" />
                    <span className="tl-section-lbl">{row.label}</span>
                  </div>
                );
              }
              const { goal } = row;
              const c = goalColor(goal);
              return (
                <div key={goal.id}
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

              {/* ── Sprint bands (very top of canvas) ── */}
              {sprintRows.map((row, rowIdx) =>
                row.map((sprint) => {
                  const sStartMs     = new Date(sprint.start_date).getTime();
                  const sEndMs       = new Date(sprint.end_date).getTime() + DAY_MS;
                  const clampedStart = Math.max(sStartMs, rangeStart.getTime());
                  const clampedEnd   = Math.min(sEndMs, rangeEnd.getTime());
                  if (clampedEnd <= clampedStart) return null;
                  const x     = ((clampedStart - rangeStart.getTime()) / DAY_MS) * pxPerDay;
                  const width = ((clampedEnd - clampedStart) / DAY_MS) * pxPerDay;
                  return (
                    <div
                      key={sprint.id}
                      className={`tl-sprint-band tl-sprint-band--${sprint.type}`}
                      {...({ style: cv({ '--tl-top': `${rowIdx * SPRINT_H + 3}px`, '--tl-left': `${x}px`, '--tl-w': `${width}px`, '--tl-h': `${SPRINT_H - 6}px` }) } as any)}
                    >
                      <span className="tl-sprint-lbl">{sprint.name}</span>
                      <button
                        type="button"
                        title="Delete period"
                        className="tl-sprint-del"
                        onClick={(e) => { e.stopPropagation(); deleteSprint(sprint.id); }}
                      >
                        ×
                      </button>
                    </div>
                  );
                })
              )}

              {/* ── Day grid lines — day / week (2px) / month (2px solid) ── */}
              {Array.from({ length: totalDays + 1 }, (_, d) => {
                const date           = new Date(rangeStart.getTime() + d * DAY_MS);
                const isFirstOfMonth = date.getDate() === 1;
                const isMonday       = date.getDay() === 1;
                const cls = isFirstOfMonth ? 'tl-month-line' : isMonday ? 'tl-week-line' : 'tl-day-line';
                return (
                  <div key={d} className={cls} {...({ style: cv({ '--tl-left': `${d * pxPerDay}px` }) } as any)} />
                );
              })}

              {/* ── Weekend shading — dynamic width via CSS var ── */}
              {Array.from({ length: totalDays }, (_, d) => {
                const date = new Date(rangeStart.getTime() + d * DAY_MS);
                if (date.getDay() !== 0 && date.getDay() !== 6) return null;
                return (
                  <div key={`w${d}`} className="tl-wknd-shade"
                    {...({ style: cv({ '--tl-left': `${d * pxPerDay}px`, '--tl-top': `${headerH}px`, '--tl-w': `${pxPerDay}px`, '--tl-h': `${trackH}px` }) } as any)}
                  />
                );
              })}

              {/* ── Row dividers + section shading ── */}
              {groupedRows.map((row, i) => (
                row.type === 'section'
                  ? <div key={`sd${i}`} className="tl-section-div" {...({ style: cv({ '--tl-top': `${headerH + row.top}px` }) } as any)} />
                  : <div key={`rd${i}`} className="tl-row-div"     {...({ style: cv({ '--tl-top': `${headerH + row.top}px` }) } as any)} />
              ))}

              {/* ── Month labels row ── */}
              <div className="tl-month-row" {...({ style: cv({ '--tl-top': `${sprintAreaH}px` }) } as any)}>
                {months.map((m, i) => (
                  <div key={i} className="tl-month-lbl" {...({ style: cv({ '--tl-left': `${m.x + 4}px` }) } as any)}>
                    {m.label}
                  </div>
                ))}
              </div>

              {/* ── Day-number row ── */}
              <div className="tl-day-row" {...({ style: cv({ '--tl-top': `${sprintAreaH + MONTH_H}px` }) } as any)}>
                {Array.from({ length: totalDays }, (_, d) => {
                  const date      = new Date(rangeStart.getTime() + d * DAY_MS);
                  const dayNum    = date.getDate();
                  const isWeekend = date.getDay() === 0 || date.getDay() === 6;
                  if (pxPerDay < 10 && dayNum !== 1) return null;
                  if (pxPerDay < 16 && dayNum % 7 !== 1 && dayNum !== 1) return null;
                  return (
                    <div
                      key={d}
                      className={`tl-day-num ${isWeekend ? 'tl-day-num--wknd' : 'tl-day-num--wkdy'}`}
                      {...({ style: cv({ '--tl-left': `${d * pxPerDay + pxPerDay / 2}px` }) } as any)}
                    >
                      {dayNum}
                    </div>
                  );
                })}
              </div>

              {/* ── Today line ── */}
              <div className="tl-today-line" {...({ style: cv({ '--tl-left': `${todayOff}px` }) } as any)}>
                <div className="tl-today-label text-[9px] font-mono font-bold tracking-wide">
                  {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>

              {/* ── Goal bars ── */}
              {groupedRows.filter((r): r is GoalRow => r.type === 'goal').map((row) => {
                const { goal }    = row;
                const deadlineOff = ((new Date(goal.deadline!).getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay;
                const createdOff  = Math.max(0, ((new Date(goal.created_at).getTime() - rangeStart.getTime()) / DAY_MS) * pxPerDay);
                const barW        = Math.max(deadlineOff - createdOff, 24);
                const fillW       = (goal.progress / 100) * barW;
                const barTop      = headerH + row.top + (ROW_H - 18) / 2;
                const c           = goalColor(goal);
                return (
                  <div key={goal.id}
                    className={`tl-bar-wrap ${onGoalClick ? 'cursor-pointer' : ''}`}
                    {...({ style: cv({ '--tl-top': `${barTop}px`, '--tl-left': `${createdOff}px`, '--tl-w': `${barW}px` }) } as any)}
                    title={`${goal.title} — ${goal.progress}%`}
                    onClick={() => onGoalClick?.(goal)}
                  >
                    <div className="tl-bar-track" {...({ style: cv({ '--tl-bg': c.bg, '--tl-border': `${c.border}40` }) } as any)} />
                    <div className="tl-bar-fill"  {...({ style: cv({ '--tl-bg': c.border, '--tl-w': `${fillW}px` }) } as any)} />
                    <div className="tl-bar-dot"   {...({ style: cv({ '--tl-bg': c.border }) } as any)} />
                  </div>
                );
              })}

              {/* ── Bottom axis ── */}
              <div className="tl-axis-bot border-t border-border/50" {...({ style: cv({ '--tl-top': `${headerH + trackH}px` }) } as any)}>
                {weekTicks.map((tick, i) => (
                  <div key={i} className="tl-tick text-[9px] font-mono text-muted/60" {...({ style: cv({ '--tl-left': `${tick.x}px` }) } as any)}>
                    {tick.label}
                  </div>
                ))}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* ── Fixed-position tooltip ── */}
      {hovered && hoveredGoal && (
        <GoalTooltip goal={hoveredGoal} members={members} y={hovered.y} color={hoveredColor} />
      )}
    </div>
  );
}
