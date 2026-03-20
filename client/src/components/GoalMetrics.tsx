import { useState, useRef, useEffect } from 'react';
import type { Goal } from '../types';

interface MemberInfo {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface GoalMetricsProps {
  goals: Goal[];
  members: MemberInfo[];
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar?: string;
  onAssignTask?: (goalId: string, userId: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  in_review: 'In Review',
  complete: 'Complete',
  at_risk: 'At Risk',
  missed: 'Missed',
};

const STATUS_COLOR: Record<string, string> = {
  not_started: 'text-muted',
  in_progress: 'text-[#D97E2A]',
  in_review: 'text-[#facc15]',
  complete: 'text-[#6DBE7D]',
  at_risk: 'text-[#D94F4F]',
  missed: 'text-danger',
};

const PROGRESS_COLOR: Record<string, string> = {
  not_started: 'bg-border',
  in_progress: 'bg-[#D97E2A]/70',
  in_review: 'bg-[#facc15]/70',
  complete: 'bg-[#6DBE7D]/70',
  at_risk: 'bg-[#D94F4F]/70',
  missed: 'bg-danger/50',
};

function MiniBar({ pct, color }: { pct: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.width = `${pct}%`;
  }, [pct]);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div ref={ref} className={`h-full rounded-full transition-all ${color}`} />
      </div>
      <span className="text-[10px] font-mono text-muted w-8 text-right">{pct}%</span>
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <h4 className="font-sans text-[10px] tracking-[0.2em] uppercase text-muted mb-3">{label}</h4>
  );
}

function TaskProgressFill({ progress, status }: { progress: number; status: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.width = `${progress}%`;
  }, [progress]);
  return (
    <div className="h-1.5 bg-border rounded-full overflow-hidden mt-1.5 mb-1.5">
      <div ref={ref} className={`h-full rounded-full transition-all ${PROGRESS_COLOR[status] ?? 'bg-border'}`} />
    </div>
  );
}

interface TaskPreviewPopupProps {
  name: string;
  tasks: Goal[];
  isUnassigned: boolean;
  members: MemberInfo[];
  onAssignTask?: (goalId: string, userId: string) => void;
  assigningGoalId: string | null;
  setAssigningGoalId: (id: string | null) => void;
}

function TaskPreviewPopup({
  name,
  tasks,
  isUnassigned,
  members,
  onAssignTask,
  assigningGoalId,
  setAssigningGoalId,
}: TaskPreviewPopupProps) {
  return (
    <div className="absolute left-0 top-full mt-2 w-full bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[10px] tracking-[0.15em] uppercase text-muted font-semibold">
          {isUnassigned ? 'Unassigned Tasks' : `${name}'s Tasks`}
        </span>
        <span className="text-[10px] font-mono text-muted">{tasks.length}</span>
      </div>

      {/* Task list */}
      <div className="max-h-64 overflow-y-auto p-2 space-y-2">
        {tasks.map((g) => (
          <div
            key={g.id}
            className="border border-border rounded p-2.5 bg-surface2 hover:border-border/80 hover:shadow-sm transition-all"
          >
            {/* Title + LOE */}
            <p className="text-xs text-heading font-medium leading-snug">{g.title}</p>
            {g.loe && (
              <p className="text-[9px] text-accent2 font-mono mt-0.5">{g.loe}</p>
            )}

            {/* Progress bar */}
            <TaskProgressFill progress={g.progress} status={g.status} />

            {/* Badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[10px] font-semibold ${STATUS_COLOR[g.status] ?? 'text-muted'}`}>
                {STATUS_LABEL[g.status] ?? g.status}
              </span>
              <span className="text-[10px] text-muted font-mono">{g.progress}%</span>
              {g.category && (
                <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">
                  {g.category}
                </span>
              )}
              {g.deadline && (
                <span className="text-[9px] text-muted font-mono">
                  {new Date(g.deadline).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Assign button for unassigned tasks */}
            {isUnassigned && onAssignTask && (
              <div className="mt-2 relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssigningGoalId(assigningGoalId === g.id ? null : g.id);
                  }}
                  className="text-[10px] px-2 py-1 border border-accent/30 text-accent rounded hover:bg-accent/5 transition-colors"
                >
                  Assign to…
                </button>

                {assigningGoalId === g.id && (
                  <div className="absolute left-0 top-full mt-1 bg-surface border border-border rounded-lg shadow-xl z-10 w-44 overflow-hidden">
                    {members.map((p) => (
                      <button
                        key={p.user_id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAssignTask(g.id, p.user_id);
                          setAssigningGoalId(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-heading hover:bg-surface2 transition-colors"
                      >
                        {p.avatar_url ? (
                          <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full shrink-0" />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                            <span className="text-[8px] text-accent font-bold uppercase">
                              {(p.display_name ?? '?')[0]}
                            </span>
                          </div>
                        )}
                        <span className="truncate">{p.display_name ?? p.user_id.slice(0, 8)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GoalMetrics({
  goals,
  members,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  onAssignTask,
}: GoalMetricsProps) {
  const [hoveredUid, setHoveredUid] = useState<string | null>(null);
  const [assigningGoalId, setAssigningGoalId] = useState<string | null>(null);

  // ── By Category ──────────────────────────────────────────────────────────
  const categoryMap = new Map<string, Goal[]>();
  for (const g of goals) {
    const cat = g.category || 'General';
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(g);
  }
  const categories = Array.from(categoryMap.entries()).sort((a, b) => b[1].length - a[1].length);

  // ── By Assignee ──────────────────────────────────────────────────────────
  const allPeople: MemberInfo[] = [
    { user_id: currentUserId, display_name: currentUserName, avatar_url: currentUserAvatar ?? null },
    ...members.filter((m) => m.user_id !== currentUserId),
  ];
  const assigneeMap = new Map<string | null, Goal[]>();
  assigneeMap.set(null, []);
  for (const p of allPeople) assigneeMap.set(p.user_id, []);
  for (const g of goals) {
    const key = g.assigned_to ?? null;
    if (!assigneeMap.has(key)) assigneeMap.set(key, []);
    assigneeMap.get(key)!.push(g);
  }

  // ── On-time Performance ───────────────────────────────────────────────────
  const timedGoals = goals.filter(
    (g) => g.status === 'complete' && g.deadline && g.completed_at
  );
  type PerfBucket = { goal: Goal; daysEarly: number };
  const perf: PerfBucket[] = timedGoals.map((g) => {
    const deadline = new Date(g.deadline!).getTime();
    const done = new Date(g.completed_at!).getTime();
    const daysEarly = Math.round((deadline - done) / (1000 * 60 * 60 * 24));
    return { goal: g, daysEarly };
  });
  const early = perf.filter((p) => p.daysEarly > 1);
  const onTime = perf.filter((p) => p.daysEarly >= -1 && p.daysEarly <= 1);
  const late = perf.filter((p) => p.daysEarly < -1);
  const avgEarly = early.length > 0 ? Math.round(early.reduce((s, p) => s + p.daysEarly, 0) / early.length) : 0;
  const avgLate = late.length > 0 ? Math.round(Math.abs(late.reduce((s, p) => s + p.daysEarly, 0)) / late.length) : 0;
  const perfTotal = perf.length || 1;

  // ── Overall Stats ─────────────────────────────────────────────────────────
  const totalGoals = goals.length;
  const completed = goals.filter((g) => g.status === 'complete').length;
  const missed = goals.filter((g) => g.status === 'missed').length;
  const atRisk = goals.filter((g) => g.status === 'at_risk').length;
  const avgProgress = totalGoals > 0
    ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / totalGoals)
    : 0;

  if (totalGoals === 0) {
    return (
      <div className="border border-border bg-surface p-12 text-center">
        <p className="text-sm text-muted">No tasks yet — add tasks to see metrics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
        {[
          { label: 'Total Tasks', value: totalGoals, color: 'text-heading' },
          { label: 'Completed', value: completed, color: 'text-accent3' },
          { label: 'At Risk', value: atRisk, color: 'text-accent' },
          { label: 'Avg Progress', value: `${avgProgress}%`, color: 'text-accent2' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-surface p-5">
            <div className={`font-sans text-2xl font-extrabold ${color}`}>{value}</div>
            <div className="text-[10px] text-muted tracking-wider uppercase mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── By Category ── */}
        <div className="border border-border bg-surface p-6">
          <SectionHeader label="Completion by Category" />
          {categories.length === 0 ? (
            <p className="text-xs text-muted">No categories assigned.</p>
          ) : (
            <div className="space-y-4">
              {categories.map(([cat, catGoals]) => {
                const done = catGoals.filter((g) => g.status === 'complete').length;
                const pct = Math.round((done / catGoals.length) * 100);
                const riskCount = catGoals.filter((g) => g.status === 'at_risk').length;
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-heading font-medium">{cat}</span>
                      <span className="text-[10px] text-muted font-mono">
                        {done}/{catGoals.length}
                        {riskCount > 0 && (
                          <span className="ml-2 text-accent">· {riskCount} at risk</span>
                        )}
                      </span>
                    </div>
                    <MiniBar pct={pct} color={pct === 100 ? 'bg-accent3' : pct >= 50 ? 'bg-accent2' : 'bg-accent'} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── By Assignee ── */}
        <div className="border border-border bg-surface p-6">
          <SectionHeader label="Completion by Assignee" />
          <div className="space-y-3">
            {Array.from(assigneeMap.entries())
              .filter(([, ag]) => ag.length > 0)
              .sort((a, b) => b[1].length - a[1].length)
              .map(([uid, ag]) => {
                const person = uid ? allPeople.find((p) => p.user_id === uid) : null;
                const name = person?.display_name ?? (uid ? uid.slice(0, 8) : 'Unassigned');
                const avatar = person?.avatar_url;
                const done = ag.filter((g) => g.status === 'complete').length;
                const risk = ag.filter((g) => g.status === 'at_risk').length;
                const missedCount = ag.filter((g) => g.status === 'missed').length;
                const pct = Math.round((done / ag.length) * 100);
                const rowKey = uid ?? 'unassigned';
                const isHovered = hoveredUid === rowKey;
                const isUnassigned = uid === null;

                return (
                  <div
                    key={rowKey}
                    className="relative"
                    onMouseEnter={() => setHoveredUid(rowKey)}
                    onMouseLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        setHoveredUid(null);
                        setAssigningGoalId(null);
                      }
                    }}
                  >
                    {/* Assignee row */}
                    <div className={`rounded px-2 py-1.5 transition-colors ${isHovered ? 'bg-surface2' : ''}`}>
                      <div className="flex items-center gap-2 mb-1">
                        {avatar ? (
                          <img src={avatar} alt="" className="w-5 h-5 rounded-full" />
                        ) : (
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isUnassigned ? 'bg-border' : 'bg-accent/20'}`}>
                            <span className={`text-[8px] font-bold uppercase ${isUnassigned ? 'text-muted' : 'text-accent'}`}>
                              {isUnassigned ? '?' : name[0]}
                            </span>
                          </div>
                        )}
                        <span className={`text-xs font-medium flex-1 ${isHovered ? 'text-heading' : 'text-heading'}`}>
                          {name}
                        </span>
                        <span className="text-[10px] font-mono text-muted">
                          {done}/{ag.length}
                          {risk > 0 && <span className="ml-1 text-accent">·{risk}⚠</span>}
                          {missedCount > 0 && <span className="ml-1 text-danger">·{missedCount}✗</span>}
                        </span>
                      </div>
                      <MiniBar pct={pct} color={pct === 100 ? 'bg-accent3' : pct >= 50 ? 'bg-accent2' : 'bg-border'} />
                    </div>

                    {/* Hover preview popup */}
                    {isHovered && (
                      <TaskPreviewPopup
                        name={name}
                        tasks={ag}
                        isUnassigned={isUnassigned}
                        members={allPeople}
                        onAssignTask={onAssignTask}
                        assigningGoalId={assigningGoalId}
                        setAssigningGoalId={setAssigningGoalId}
                      />
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* ── On-time Performance ── */}
      <div className="border border-border bg-surface p-6">
        <SectionHeader label="On-Time Performance (completed tasks with deadlines)" />
        {perf.length === 0 ? (
          <p className="text-xs text-muted">
            No completed tasks with deadlines yet. Mark a task complete to see timing data.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-px bg-border border border-border">
              {[
                { label: 'Early', count: early.length, detail: avgEarly > 0 ? `avg ${avgEarly}d early` : '', color: 'text-accent3' },
                { label: 'On Time', count: onTime.length, detail: '±1 day of deadline', color: 'text-accent2' },
                { label: 'Late', count: late.length, detail: avgLate > 0 ? `avg ${avgLate}d late` : '', color: 'text-danger' },
              ].map(({ label, count, detail, color }) => (
                <div key={label} className="bg-surface p-4 text-center">
                  <div className={`font-sans text-xl font-extrabold ${color}`}>{count}</div>
                  <div className="text-[10px] text-muted tracking-wider uppercase">{label}</div>
                  {detail && <div className="text-[10px] text-muted mt-0.5">{detail}</div>}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[10px] text-muted mb-1">
                  <span className="text-accent3">Early</span>
                  <span>{Math.round((early.length / perfTotal) * 100)}%</span>
                </div>
                <MiniBar pct={Math.round((early.length / perfTotal) * 100)} color="bg-accent3" />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-muted mb-1">
                  <span className="text-accent2">On Time</span>
                  <span>{Math.round((onTime.length / perfTotal) * 100)}%</span>
                </div>
                <MiniBar pct={Math.round((onTime.length / perfTotal) * 100)} color="bg-accent2" />
              </div>
              <div>
                <div className="flex justify-between text-[10px] text-muted mb-1">
                  <span className="text-danger">Late</span>
                  <span>{Math.round((late.length / perfTotal) * 100)}%</span>
                </div>
                <MiniBar pct={Math.round((late.length / perfTotal) * 100)} color="bg-danger" />
              </div>
            </div>

            {/* Per-goal breakdown */}
            <div className="border-t border-border pt-4">
              <div className="text-[10px] tracking-[0.15em] uppercase text-muted mb-2">Task Breakdown</div>
              <div className="space-y-1">
                {perf.sort((a, b) => b.daysEarly - a.daysEarly).map(({ goal, daysEarly }) => (
                  <div key={goal.id} className="flex items-center gap-3 text-xs">
                    <span className="flex-1 text-heading truncate">{goal.title}</span>
                    <span className={`font-mono text-[10px] ${daysEarly > 1 ? 'text-accent3' : daysEarly < -1 ? 'text-danger' : 'text-accent2'}`}>
                      {daysEarly > 1 ? `${daysEarly}d early` : daysEarly < -1 ? `${Math.abs(daysEarly)}d late` : 'on time'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Missed Goals ── */}
      {missed > 0 && (
        <div className="border border-danger/20 bg-danger/5 p-4">
          <div className="text-[10px] tracking-[0.15em] uppercase text-danger mb-2">Missed Deadlines ({missed})</div>
          <div className="space-y-1">
            {goals.filter((g) => g.status === 'missed').map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-xs text-heading">
                <span className="w-1.5 h-1.5 rounded-full bg-danger shrink-0" />
                <span className="flex-1">{g.title}</span>
                {g.deadline && (
                  <span className="text-[10px] font-mono text-muted">
                    due {new Date(g.deadline).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
