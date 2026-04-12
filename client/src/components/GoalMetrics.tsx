import { useState, useRef, useEffect } from 'react';
import { List, X, Clock, ShieldAlert } from 'lucide-react';
import UserAvatar from './UserAvatar';
import type { Goal, TimeLog } from '../types';

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
  timeLogs?: TimeLog[];
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
  members: MemberInfo[];
  onAssignTask?: (goalId: string, userId: string) => void;
  onClose: () => void;
}

function TaskPreviewPopup({ name, tasks, members, onAssignTask, onClose }: TaskPreviewPopupProps) {
  const [assigningGoalId, setAssigningGoalId] = useState<string | null>(null);

  return (
    <div className="absolute left-0 top-full mt-1 w-full bg-surface border border-border rounded-lg shadow-xl z-50 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[10px] tracking-[0.15em] uppercase text-muted font-semibold">
          {name}'s Tasks
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted">{tasks.length}</span>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="p-0.5 rounded text-muted hover:text-heading hover:bg-surface2 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Task list */}
      <div className="max-h-96 overflow-y-auto p-2 space-y-2">
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

            {/* Assign / Reassign */}
            {onAssignTask && (
              <div className="mt-2 relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAssigningGoalId(assigningGoalId === g.id ? null : g.id);
                  }}
                  className="text-[10px] px-2 py-1 border border-accent/30 text-accent rounded hover:bg-accent/5 transition-colors"
                >
                  {g.assigned_to ? 'Reassign…' : 'Assign to…'}
                </button>

                {assigningGoalId === g.id && (
                  <div className="absolute left-0 bottom-full mb-1 bg-surface border border-border rounded-lg shadow-xl z-10 w-44 overflow-hidden">
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
                        <UserAvatar
                          label={p.display_name ?? p.user_id}
                          avatar={p.avatar_url}
                          className="w-5 h-5 shrink-0"
                          fallbackClassName="bg-accent/20 text-accent"
                          textClassName="text-[8px] font-bold uppercase"
                        />
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
  timeLogs = [],
}: GoalMetricsProps) {
  const [openUid, setOpenUid] = useState<string | null>(null);

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
  const today = new Date();
  const twoWeeksFromNow = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
  const actualHoursByGoal = new Map<string, number>();
  for (const log of timeLogs) {
    actualHoursByGoal.set(log.goal_id, (actualHoursByGoal.get(log.goal_id) ?? 0) + log.logged_hours);
  }
  const plannedGoals = goals.filter((goal) => (goal.estimated_hours ?? 0) > 0 || (actualHoursByGoal.get(goal.id) ?? 0) > 0);
  const plannedHours = plannedGoals.reduce((sum, goal) => sum + (goal.estimated_hours ?? 0), 0);
  const actualHours = plannedGoals.reduce((sum, goal) => sum + (actualHoursByGoal.get(goal.id) ?? 0), 0);
  const remainingHours = plannedGoals
    .filter((goal) => goal.status !== 'complete')
    .reduce((sum, goal) => sum + Math.max((goal.estimated_hours ?? 0) - (actualHoursByGoal.get(goal.id) ?? 0), 0), 0);
  const scheduleAtRisk = goals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) <= twoWeeksFromNow && goal.progress < 80).length;
  const overdueOpen = goals.filter((goal) => goal.status !== 'complete' && goal.deadline && new Date(goal.deadline) < today).length;
  const planningVariance = actualHours - plannedHours;
  const activePlanningPeople = allPeople.map((person) => {
    const assignedGoals = goals.filter((goal) => (goal.assignees?.length ? goal.assignees : goal.assigned_to ? [goal.assigned_to] : []).includes(person.user_id));
    const recentHours = timeLogs
      .filter((log) => log.user_id === person.user_id)
      .reduce((sum, log) => sum + log.logged_hours, 0);
    const plannedLoad = assignedGoals.reduce((sum, goal) => sum + Math.max((goal.estimated_hours ?? 0) - (actualHoursByGoal.get(goal.id) ?? 0), 0), 0);
    const blockedOrLate = assignedGoals.filter((goal) => goal.status === 'at_risk' || goal.status === 'missed' || (goal.deadline && new Date(goal.deadline) < today)).length;
    return {
      ...person,
      activeTasks: assignedGoals.filter((goal) => goal.status !== 'complete').length,
      plannedLoad,
      recentHours,
      blockedOrLate,
    };
  }).filter((person) => person.activeTasks > 0 || person.plannedLoad > 0 || person.recentHours > 0);

  if (totalGoals === 0) {
    return (
      <div className="border border-border bg-surface p-12 text-center">
        <p className="text-sm text-muted">No tasks yet — add tasks to see metrics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Backdrop — clicking outside any open popup closes it */}
      {openUid && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenUid(null)} />
      )}
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
                const isOpen = openUid === rowKey;

                return (
                  <div key={rowKey} className="relative">
                    {/* Assignee row */}
                    <div className={`rounded px-2 py-1.5 transition-colors ${isOpen ? 'bg-surface2' : ''}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <UserAvatar
                          label={name}
                          avatar={avatar}
                          className="w-5 h-5"
                          fallbackClassName={uid === null ? 'bg-border text-muted' : 'bg-accent/20 text-accent'}
                          textClassName="text-[8px] font-bold uppercase"
                        />
                        <span className="text-xs font-medium flex-1 text-heading">{name}</span>
                        <span className="text-[10px] font-mono text-muted">
                          {done}/{ag.length}
                          {risk > 0 && <span className="ml-1 text-accent">·{risk}⚠</span>}
                          {missedCount > 0 && <span className="ml-1 text-danger">·{missedCount}✗</span>}
                        </span>
                        <button
                          type="button"
                          title="See tasks"
                          onClick={() => setOpenUid(isOpen ? null : rowKey)}
                          className={`flex items-center gap-1 text-[10px] px-2 py-0.5 border rounded transition-colors ${
                            isOpen
                              ? 'border-accent/40 text-accent bg-accent/5'
                              : 'border-border text-muted hover:text-heading hover:border-border/80'
                          }`}
                        >
                          <List size={10} />
                          {isOpen ? 'Hide' : 'See Tasks'}
                        </button>
                      </div>
                      <MiniBar pct={pct} color={pct === 100 ? 'bg-accent3' : pct >= 50 ? 'bg-accent2' : 'bg-border'} />
                    </div>

                    {/* Click-to-open task preview */}
                    {isOpen && (
                      <TaskPreviewPopup
                        name={name}
                        tasks={ag}
                        members={allPeople}
                        onAssignTask={onAssignTask}
                        onClose={() => setOpenUid(null)}
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

      {/* ── Planning Depth ── */}
      <div className="border border-border bg-surface p-6">
        <SectionHeader label="Planning Depth" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border mb-5">
          {[
            { label: 'Planned Hours', value: plannedHours.toFixed(1), color: 'text-accent2' },
            { label: 'Actual Hours', value: actualHours.toFixed(1), color: 'text-heading' },
            { label: 'Remaining Load', value: remainingHours.toFixed(1), color: 'text-accent3' },
            { label: 'Schedule Risks', value: scheduleAtRisk + overdueOpen, color: 'text-accent' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-surface p-4">
              <div className={`font-sans text-xl font-extrabold ${color}`}>{value}</div>
              <div className="text-[10px] text-muted tracking-wider uppercase mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted">Planned vs Actual</div>
            <p className="text-xs text-muted leading-relaxed">
              {plannedGoals.length > 0
                ? `Tracked estimates cover ${plannedGoals.length} task${plannedGoals.length === 1 ? '' : 's'}. Variance is ${planningVariance >= 0 ? '+' : ''}${planningVariance.toFixed(1)}h against current estimates.`
                : 'No task estimates are recorded yet. Add estimated hours on tasks to unlock variance tracking.'}
            </p>
            <MiniBar
              pct={plannedHours > 0 ? Math.min(100, Math.round((actualHours / plannedHours) * 100)) : 0}
              color={planningVariance > 0 ? 'bg-danger' : 'bg-accent2'}
            />
            <div className="text-[10px] text-muted font-mono">
              {overdueOpen} overdue open task{overdueOpen === 1 ? '' : 's'} · {scheduleAtRisk} deadline-sensitive task{scheduleAtRisk === 1 ? '' : 's'} in the next 14 days
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted">Capacity and Allocation</div>
            {activePlanningPeople.length === 0 ? (
              <p className="text-xs text-muted">No member-level planning data yet.</p>
            ) : (
              activePlanningPeople
                .sort((left, right) => right.plannedLoad - left.plannedLoad || right.recentHours - left.recentHours)
                .slice(0, 5)
                .map((person) => (
                  <div key={person.user_id} className="rounded border border-border bg-surface2/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-heading font-medium truncate">{person.display_name ?? person.user_id}</span>
                      <span className={`text-[10px] font-mono ${person.blockedOrLate > 0 ? 'text-danger' : person.plannedLoad > Math.max(person.recentHours * 1.5, 12) ? 'text-accent' : 'text-accent3'}`}>
                        {person.plannedLoad.toFixed(1)}h remaining
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-muted font-mono">
                      {person.activeTasks} active · {person.recentHours.toFixed(1)}h logged · {person.blockedOrLate} late/at-risk
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      </div>

      {/* ── Time Tracking ── */}
      {timeLogs.length > 0 && (() => {
        const totalHours = timeLogs.reduce((s, l) => s + l.logged_hours, 0);

        // Hours by category
        const hoursByCategory = new Map<string, number>();
        for (const log of timeLogs) {
          const goal = goals.find(g => g.id === log.goal_id);
          const cat = goal?.category || 'General';
          hoursByCategory.set(cat, (hoursByCategory.get(cat) ?? 0) + log.logged_hours);
        }
        const sortedCats = Array.from(hoursByCategory.entries()).sort((a, b) => b[1] - a[1]);
        const maxCatHours = Math.max(...sortedCats.map(([, h]) => h), 1);

        // Hours by assignee
        const hoursByAssignee = new Map<string, number>();
        for (const log of timeLogs) {
          const uid = log.user_id ?? 'unknown';
          hoursByAssignee.set(uid, (hoursByAssignee.get(uid) ?? 0) + log.logged_hours);
        }
        const sortedAssignees = Array.from(hoursByAssignee.entries()).sort((a, b) => b[1] - a[1]);
        const maxAssigneeHours = Math.max(...sortedAssignees.map(([, h]) => h), 1);

        return (
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock size={13} className="text-[var(--color-accent2)]" />
              <SectionHeader label="Time Tracking" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Total stat */}
              <div>
                <div className="text-3xl font-extrabold text-[var(--color-accent2)] font-sans mb-0.5">{totalHours.toFixed(1)}h</div>
                <div className="text-[10px] text-[var(--color-muted)] uppercase tracking-widest">Total Hours Logged</div>
                <div className="text-[10px] text-[var(--color-muted)] mt-1">{timeLogs.length} log entries across {goals.filter(g => timeLogs.some(l => l.goal_id === g.id)).length} tasks</div>
              </div>

              {/* Hours by category mini bars */}
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] mb-2">By Category</div>
                <div className="space-y-2">
                  {sortedCats.slice(0, 5).map(([cat, hrs]) => (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[10px] text-[var(--color-heading)] font-mono truncate">{cat}</span>
                        <span className="text-[10px] text-[var(--color-muted)] font-mono shrink-0 ml-2">{hrs.toFixed(1)}h</span>
                      </div>
                      <MiniBar pct={Math.round((hrs / maxCatHours) * 100)} color="bg-[var(--color-accent2)]/70" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Hours by assignee */}
            {sortedAssignees.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
                <div className="text-[10px] uppercase tracking-widest text-[var(--color-muted)] mb-2">By Contributor</div>
                <div className="space-y-2">
                  {sortedAssignees.slice(0, 5).map(([uid, hrs]) => {
                    const person = allPeople.find(p => p.user_id === uid);
                    const name = person?.display_name ?? uid.slice(0, 8);
                    return (
                      <div key={uid}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-[10px] text-[var(--color-heading)] font-mono truncate">{name}</span>
                          <span className="text-[10px] text-[var(--color-muted)] font-mono shrink-0 ml-2">{hrs.toFixed(1)}h</span>
                        </div>
                        <MiniBar pct={Math.round((hrs / maxAssigneeHours) * 100)} color="bg-[var(--color-accent)]/70" />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── Risk Overview ── */}
      {goals.some(g => g.risk_score != null) && (() => {
        const scored = goals.filter(g => g.risk_score != null);
        const low = scored.filter(g => (g.risk_score ?? 0) < 0.25).length;
        const medium = scored.filter(g => (g.risk_score ?? 0) >= 0.25 && (g.risk_score ?? 0) < 0.5).length;
        const high = scored.filter(g => (g.risk_score ?? 0) >= 0.5 && (g.risk_score ?? 0) < 0.75).length;
        const critical = scored.filter(g => (g.risk_score ?? 0) >= 0.75).length;
        const highRiskGoals = scored.filter(g => (g.risk_score ?? 0) >= 0.5).sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));

        const riskColor = (score: number) =>
          score >= 0.75 ? 'text-[var(--color-danger)] bg-[var(--color-danger)]/10 border-[var(--color-danger)]/20'
          : score >= 0.5 ? 'text-orange-400 bg-orange-400/10 border-orange-400/20'
          : score >= 0.25 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20'
          : 'text-[var(--color-accent3)] bg-[var(--color-accent3)]/10 border-[var(--color-accent3)]/20';

        const riskLabel = (score: number) =>
          score >= 0.75 ? 'Critical' : score >= 0.5 ? 'High' : score >= 0.25 ? 'Medium' : 'Low';

        return (
          <div className="border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <div className="flex items-center gap-2 mb-4">
              <ShieldAlert size={13} className="text-[var(--color-accent)]" />
              <SectionHeader label="Risk Overview" />
            </div>

            {/* Distribution */}
            <div className="grid grid-cols-4 gap-px bg-[var(--color-border)] border border-[var(--color-border)] mb-4">
              {[
                { label: 'Low', count: low, cls: 'text-[var(--color-accent3)]' },
                { label: 'Medium', count: medium, cls: 'text-yellow-400' },
                { label: 'High', count: high, cls: 'text-orange-400' },
                { label: 'Critical', count: critical, cls: 'text-[var(--color-danger)]' },
              ].map(({ label, count, cls }) => (
                <div key={label} className="bg-[var(--color-surface)] p-3 text-center">
                  <div className={`text-xl font-extrabold font-sans ${cls}`}>{count}</div>
                  <div className="text-[9px] text-[var(--color-muted)] uppercase tracking-wider">{label}</div>
                </div>
              ))}
            </div>

            {/* High + Critical list */}
            {highRiskGoals.length > 0 ? (
              <div className="space-y-1.5">
                {highRiskGoals.map(g => (
                  <div key={g.id} className="flex items-center gap-2">
                    <span className={`text-[9px] px-1.5 py-0.5 border rounded font-mono font-semibold shrink-0 ${riskColor(g.risk_score ?? 0)}`}>
                      {riskLabel(g.risk_score ?? 0)}
                    </span>
                    <span className="text-xs text-[var(--color-heading)] truncate">{g.title}</span>
                    <span className="text-[10px] text-[var(--color-muted)] font-mono shrink-0">{Math.round((g.risk_score ?? 0) * 100)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">No high-risk tasks. Run "Assess Risk" to update scores.</p>
            )}
          </div>
        );
      })()}
    </div>
  );
}
