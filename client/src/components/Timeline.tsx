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

export default function Timeline({ goals, members = [] }: TimelineProps) {
  const [hovered, setHovered] = useState<string | null>(null);

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

  const catColorMap = makeCatColorMap(goalsWithDeadline);
  const catColor = (goal: Goal) => catColorMap.get(goal.category ?? '') ?? DEFAULT_COLOR;

  if (goalsWithDeadline.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-muted tracking-wide">Set deadlines on goals to see the timeline</p>
      </div>
    );
  }

  const earliest = new Date(goalsWithDeadline[0].deadline!);
  const latest = new Date(goalsWithDeadline[goalsWithDeadline.length - 1].deadline!);
  const rangeStart = new Date(Math.min(now.getTime(), earliest.getTime()) - 7 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
  const viewStart = rangeStart;
  const viewEnd   = rangeEnd;
  const viewRange = viewEnd.getTime() - viewStart.getTime();

  const toPct = (ms: number): string =>
    `${Math.min(100, Math.max(0, ((ms - viewStart.getTime()) / viewRange) * 100)).toFixed(3)}%`;

  const nowPct = toPct(now.getTime());

  const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

  return (
    <div>
      {/* Date range header — animates with the zoom */}
      <div className="tlo-header flex mb-2">
        <div className="tlo-date-row text-[10px] text-muted font-mono">
          <span className="tlo-date-label">{fmtDate(viewStart)}</span>
          <span className="tlo-date-label">{fmtDate(viewEnd)}</span>
        </div>
      </div>

      {/* Track — grouped by category */}
      <div className="tlo-track-outer border border-border rounded bg-surface">
        {(() => {
          // Build ordered list of [category, goals[]] preserving deadline sort within each group
          const categoryOrder = [...new Set(goalsWithDeadline.map((g) => g.category ?? ''))];
          const groups = categoryOrder.map((cat) => ({
            cat,
            goals: goalsWithDeadline.filter((g) => (g.category ?? '') === cat),
          }));
          let firstGoal = true;

          return groups.map(({ cat, goals: groupGoals }) => {
            const c = catColorMap.get(cat) ?? DEFAULT_COLOR;
            return (
              <div key={cat}>
                {/* Section header */}
                <div className="tlo-section" {...({ style: cv({ '--tlo-color': c.color }) } as any)}>
                  <span className="tlo-section-lbl">{cat || 'Uncategorized'}</span>
                  <div className="tlo-section-line" />
                </div>

                {groupGoals.map((goal, idxInGroup) => {
                  const deadlineMs  = new Date(goal.deadline!).getTime();
                  const deadlinePct = toPct(deadlineMs);
                  const progressPct = `${((goal.progress / 100) * parseFloat(deadlinePct)).toFixed(3)}%`;
                  const isHovered   = hovered === goal.id;
                  const isFirst     = firstGoal;
                  if (firstGoal) firstGoal = false;

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
            );
          });
        })()}
      </div>
    </div>
  );
}
