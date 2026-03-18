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
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
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

export default function GoalMetrics({ goals, members, currentUserId, currentUserName, currentUserAvatar }: GoalMetricsProps) {
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
        <p className="text-sm text-muted">No goals yet — add goals to see metrics.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border">
        {[
          { label: 'Total Goals', value: totalGoals, color: 'text-heading' },
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
                const missed = ag.filter((g) => g.status === 'missed').length;
                const pct = Math.round((done / ag.length) * 100);
                return (
                  <div key={uid ?? 'unassigned'}>
                    <div className="flex items-center gap-2 mb-1">
                      {avatar ? (
                        <img src={avatar} alt="" className="w-5 h-5 rounded-full" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center">
                          <span className="text-[8px] text-accent font-bold uppercase">{name[0]}</span>
                        </div>
                      )}
                      <span className="text-xs text-heading font-medium flex-1">{name}</span>
                      <span className="text-[10px] font-mono text-muted">
                        {done}/{ag.length}
                        {risk > 0 && <span className="ml-1 text-accent">·{risk}⚠</span>}
                        {missed > 0 && <span className="ml-1 text-danger">·{missed}✗</span>}
                      </span>
                    </div>
                    <MiniBar pct={pct} color={pct === 100 ? 'bg-accent3' : pct >= 50 ? 'bg-accent2' : 'bg-border'} />
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* ── On-time Performance ── */}
      <div className="border border-border bg-surface p-6">
        <SectionHeader label="On-Time Performance (completed goals with deadlines)" />
        {perf.length === 0 ? (
          <p className="text-xs text-muted">
            No completed goals with deadlines yet. Mark a goal complete to see timing data.
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
              <div className="text-[10px] tracking-[0.15em] uppercase text-muted mb-2">Goal Breakdown</div>
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
