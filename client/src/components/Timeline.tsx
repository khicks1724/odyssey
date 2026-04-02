import { useState } from 'react';
import type { Goal } from '../../types';
import './Timeline.css';

function cv(vars: Record<string, string | number>): React.CSSProperties {
  return vars as unknown as React.CSSProperties;
}

const GROUP_PALETTE: { color: string; track: string }[] = [
  { color: '#3b8eea', track: 'rgba(59,142,234,0.18)' },
  { color: '#52c98e', track: 'rgba(82,201,142,0.18)' },
  { color: '#e8a235', track: 'rgba(232,162,53,0.18)' },
  { color: '#bd93f9', track: 'rgba(189,147,249,0.18)' },
  { color: '#e85555', track: 'rgba(232,85,85,0.18)' },
  { color: '#8be9fd', track: 'rgba(139,233,253,0.18)' },
  { color: '#ffb86c', track: 'rgba(255,184,108,0.18)' },
  { color: '#dc7070', track: 'rgba(220,112,112,0.18)' },
];
const DEFAULT_COLOR = { color: '#5a6a7e', track: 'rgba(90,106,126,0.18)' };

function makeCatColorMap(goals: Goal[]): Map<string, { color: string; track: string }> {
  const keys = [...new Set(goals.map((g) => g.category ?? ''))];
  const map = new Map<string, { color: string; track: string }>();
  keys.forEach((k, i) => map.set(k, GROUP_PALETTE[i % GROUP_PALETTE.length]));
  return map;
}

interface MemberInfo { user_id: string; display_name: string | null; }

interface TimelineProps {
  goals: Goal[];
  members?: MemberInfo[];
}

function GoalTooltip({ goal, members, color }: { goal: Goal; members: MemberInfo[]; color: string }) {
  const assigneeIds: string[] = goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []);
  const assigneeNames = assigneeIds.map((id) => members.find((m) => m.user_id === id)?.display_name ?? 'Unknown');

  const statusLabels: Record<string, string> = {
    not_started: 'Not Started',
    in_progress: 'In Progress',
    in_review: 'In Review',
    complete: 'Complete',
  };

  return (
    <div className="tlo-tooltip">
      <div className="tlo-tooltip-bar" {...({ style: cv({ '--tlo-color': color }) } as any)} />
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
              <span className="text-[10px] font-mono tlo-cat-text" {...({ style: cv({ '--tlo-color': color }) } as any)}>{goal.category}</span>
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

// ── Tick line generator ──────────────────────────────────────────────────────

interface Tick { pct: string; label: string; isMajor: boolean; }

function buildTicks(viewStart: Date, viewEnd: Date, toPct: (ms: number) => string): Tick[] {
  const ticks: Tick[] = [];
  const rangeMs = viewEnd.getTime() - viewStart.getTime();
  const days = rangeMs / (1000 * 60 * 60 * 24);

  if (days <= 60) {
    // Weekly ticks with day numbers
    const cursor = new Date(viewStart);
    cursor.setDate(cursor.getDate() + ((1 - cursor.getDay() + 7) % 7)); // advance to next Monday
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= viewEnd) {
      const pct = toPct(cursor.getTime());
      ticks.push({
        pct,
        label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        isMajor: cursor.getDate() <= 7, // first week of month = major
      });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    // Monthly ticks
    const cursor = new Date(viewStart.getFullYear(), viewStart.getMonth() + 1, 1);
    while (cursor <= viewEnd) {
      ticks.push({
        pct: toPct(cursor.getTime()),
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
        isMajor: cursor.getMonth() === 0, // Jan = major (year boundary)
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return ticks;
}

// ── Filter bar ───────────────────────────────────────────────────────────────

type GroupBy = 'category' | 'loe' | 'none';

function FilterBar({
  categories, loes, filterCat, filterLoe, groupBy,
  onFilterCat, onFilterLoe, onGroupBy,
}: {
  categories: string[]; loes: string[];
  filterCat: string; filterLoe: string; groupBy: GroupBy;
  onFilterCat: (v: string) => void; onFilterLoe: (v: string) => void; onGroupBy: (v: GroupBy) => void;
}) {
  const selectCls = 'text-[10px] font-mono bg-surface border border-border text-muted px-2 py-1 focus:outline-none focus:border-accent/50 rounded';
  const btnCls = (active: boolean) =>
    `text-[10px] font-mono px-2 py-1 rounded border transition-colors ${active
      ? 'bg-accent/10 border-accent/30 text-accent'
      : 'bg-surface border-border text-muted hover:text-heading hover:border-border/80'}`;

  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      {/* Category filter */}
      {categories.length > 1 && (
        <select value={filterCat} onChange={(e) => onFilterCat(e.target.value)} className={selectCls} title="Filter by category">
          <option value="">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c || 'Uncategorized'}</option>)}
        </select>
      )}

      {/* LOE filter */}
      {loes.length > 1 && (
        <select value={filterLoe} onChange={(e) => onFilterLoe(e.target.value)} className={selectCls} title="Filter by LOE">
          <option value="">All LOE</option>
          {loes.map((l) => <option key={l} value={l}>{l || 'No LOE'}</option>)}
        </select>
      )}

      {/* Group by toggle */}
      <div className="flex items-center gap-1 ml-auto">
        <span className="text-[9px] text-muted/60 font-mono uppercase tracking-wider mr-1">Group by</span>
        <button type="button" className={btnCls(groupBy === 'category')} onClick={() => onGroupBy('category')}>Category</button>
        <button type="button" className={btnCls(groupBy === 'loe')} onClick={() => onGroupBy('loe')}>LOE</button>
        <button type="button" className={btnCls(groupBy === 'none')} onClick={() => onGroupBy('none')}>None</button>
      </div>
    </div>
  );
}

// ── Main export ──────────────────────────────────────────────────────────────

export default function Timeline({ goals, members = [] }: TimelineProps) {
  const [hovered, setHovered]   = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState('');
  const [filterLoe, setFilterLoe] = useState('');
  const [groupBy, setGroupBy]   = useState<GroupBy>('category');

  if (goals.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-muted tracking-wide">Add goals with deadlines to see the timeline</p>
      </div>
    );
  }

  const now = new Date();
  const goalsWithDeadline = goals
    .filter((g) => g.deadline)
    .sort((a, b) => new Date(a.deadline!).getTime() - new Date(b.deadline!).getTime());

  if (goalsWithDeadline.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-muted tracking-wide">Set deadlines on goals to see the timeline</p>
      </div>
    );
  }

  // Collect unique categories + LOEs for filter dropdowns
  const allCategories = [...new Set(goalsWithDeadline.map((g) => g.category ?? ''))];
  const allLoes = [...new Set(goalsWithDeadline.map((g) => g.loe ?? '').filter(Boolean))];

  // Apply filters
  const filtered = goalsWithDeadline.filter((g) => {
    if (filterCat && (g.category ?? '') !== filterCat) return false;
    if (filterLoe && (g.loe ?? '') !== filterLoe) return false;
    return true;
  });

  if (filtered.length === 0) {
    return (
      <div>
        <FilterBar categories={allCategories} loes={allLoes} filterCat={filterCat} filterLoe={filterLoe} groupBy={groupBy}
          onFilterCat={setFilterCat} onFilterLoe={setFilterLoe} onGroupBy={setGroupBy} />
        <div className="py-8 text-center">
          <p className="text-xs text-muted tracking-wide">No goals match the current filters</p>
        </div>
      </div>
    );
  }

  const catColorMap = makeCatColorMap(goalsWithDeadline);

  // Build LOE color map using same palette
  const loeColorMap = new Map<string, { color: string; track: string }>();
  [...new Set(goalsWithDeadline.map((g) => g.loe ?? ''))].forEach((l, i) =>
    loeColorMap.set(l, GROUP_PALETTE[i % GROUP_PALETTE.length])
  );

  const rowColor = (goal: Goal): { color: string; track: string } => {
    if (groupBy === 'loe') return loeColorMap.get(goal.loe ?? '') ?? DEFAULT_COLOR;
    return catColorMap.get(goal.category ?? '') ?? DEFAULT_COLOR;
  };

  // Timeline extents
  const earliest = new Date(filtered[0].deadline!);
  const latest   = new Date(filtered[filtered.length - 1].deadline!);
  const viewStart = new Date(Math.min(now.getTime(), earliest.getTime()) - 7 * 24 * 60 * 60 * 1000);
  const viewEnd   = new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
  const viewRange = viewEnd.getTime() - viewStart.getTime();

  const toPct = (ms: number): string =>
    `${Math.min(100, Math.max(0, ((ms - viewStart.getTime()) / viewRange) * 100)).toFixed(3)}%`;

  const nowPct  = toPct(now.getTime());
  const ticks   = buildTicks(viewStart, viewEnd, toPct);
  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

  // Build groups
  type Group = { key: string; goals: Goal[]; color: { color: string; track: string } };
  let groups: Group[];

  if (groupBy === 'none') {
    groups = [{ key: '', goals: filtered, color: DEFAULT_COLOR }];
  } else {
    const groupKey = (g: Goal) => groupBy === 'loe' ? (g.loe ?? '') : (g.category ?? '');
    const colorMap = groupBy === 'loe' ? loeColorMap : catColorMap;
    const order = [...new Set(filtered.map(groupKey))];
    groups = order.map((k) => ({
      key: k,
      goals: filtered.filter((g) => groupKey(g) === k),
      color: colorMap.get(k) ?? DEFAULT_COLOR,
    }));
  }

  return (
    <div>
      <FilterBar categories={allCategories} loes={allLoes} filterCat={filterCat} filterLoe={filterLoe} groupBy={groupBy}
        onFilterCat={setFilterCat} onFilterLoe={setFilterLoe} onGroupBy={setGroupBy} />

      {/* Date range header */}
      <div className="tlo-header flex mb-2">
        <div className="tlo-date-row text-[10px] text-muted font-mono">
          <span className="tlo-date-label">{fmtDate(viewStart)}</span>
          <span className="tlo-date-label">{fmtDate(viewEnd)}</span>
        </div>
      </div>

      {/* Track */}
      <div className="tlo-track-outer border border-border rounded bg-surface">

        {/* Tick header row */}
        {ticks.length > 0 && (
          <div className="tlo-tick-header">
            <div className="tlo-label" style={{ background: 'var(--color-surface2)' }} />
            <div className="tlo-chart tlo-tick-chart">
              {ticks.map((t) => (
                <div
                  key={t.pct}
                  className={`tlo-tick ${t.isMajor ? 'tlo-tick--major' : ''}`}
                  style={{ left: t.pct }}
                >
                  <span className="tlo-tick-lbl">{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {groups.map(({ key, goals: groupGoals, color: groupColor }, gi) => (
          <div key={key || `group-${gi}`}>
            {/* Section header (only when grouping is active) */}
            {groupBy !== 'none' && (
              <div className="tlo-section" {...({ style: cv({ '--tlo-color': groupColor.color }) } as any)}>
                <span className="tlo-section-lbl">{key || (groupBy === 'loe' ? 'No LOE' : 'Uncategorized')}</span>
                <div className="tlo-section-line" />
              </div>
            )}

            {groupGoals.map((goal, idxInGroup) => {
              const c = rowColor(goal);
              const deadlineMs  = new Date(goal.deadline!).getTime();
              const deadlinePct = toPct(deadlineMs);
              const progressPct = `${((goal.progress / 100) * parseFloat(deadlinePct)).toFixed(3)}%`;
              const isHovered   = hovered === goal.id;
              const isFirst     = gi === 0 && idxInGroup === 0;

              return (
                <div
                  key={goal.id}
                  className={`tlo-row${idxInGroup < groupGoals.length - 1 ? ' tlo-row-border' : ''}`}
                  {...({ style: cv({ '--tlo-color': c.color }) } as any)}
                  onMouseEnter={() => setHovered(goal.id)}
                  onMouseLeave={() => setHovered(null)}
                >
                  <div className="tlo-label tlo-label-hover">
                    <span className="tlo-cat-dot" />
                    <span className="text-[10px] font-mono truncate tlo-cat-text" title={goal.title}>
                      {goal.title}
                    </span>
                  </div>

                  {isHovered && (
                    <GoalTooltip goal={goal} members={members} color={c.color} />
                  )}

                  <div className="tlo-chart">
                    {/* Tick grid lines behind bars */}
                    {ticks.map((t) => (
                      <div
                        key={t.pct}
                        className={`tlo-tick-line ${t.isMajor ? 'tlo-tick-line--major' : ''}`}
                        style={{ left: t.pct }}
                      />
                    ))}

                    <div className="tlo-today" {...({ style: cv({ '--tlo-now': nowPct }) } as any)}>
                      {isFirst && (
                        <span className="tlo-today-lbl text-[9px] text-accent font-mono">
                          {now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                    <div className="tlo-track" {...({ style: cv({ '--tlo-deadline': deadlinePct, '--tlo-track': c.track }) } as any)} />
                    <div className="tlo-fill"  {...({ style: cv({ '--tlo-progress': progressPct, '--tlo-color': c.color }) } as any)} />
                    <div className="tlo-dot"   {...({ style: cv({ '--tlo-deadline': deadlinePct, '--tlo-color': c.color }) } as any)} />
                    <span className="tlo-pct text-[10px] font-mono text-heading">{goal.progress}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
