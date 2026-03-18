import type { Goal } from '../../types';

interface TimelineProps {
  goals: Goal[];
}

export default function Timeline({ goals }: TimelineProps) {
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

  // Calculate range
  const earliest = new Date(goalsWithDeadline[0].deadline!);
  const latest = new Date(goalsWithDeadline[goalsWithDeadline.length - 1].deadline!);
  const rangeStart = new Date(Math.min(now.getTime(), earliest.getTime()) - 7 * 24 * 60 * 60 * 1000);
  const rangeEnd = new Date(latest.getTime() + 7 * 24 * 60 * 60 * 1000);
  const totalRange = rangeEnd.getTime() - rangeStart.getTime();

  const statusColors: Record<string, string> = {
    active: 'bg-accent2 border-accent2',
    at_risk: 'bg-accent border-accent',
    complete: 'bg-accent3 border-accent3',
    missed: 'bg-danger border-danger',
  };

  const nowPosition = ((now.getTime() - rangeStart.getTime()) / totalRange) * 100;

  return (
    <div className="relative">
      {/* Month labels */}
      <div className="flex justify-between text-[10px] text-muted font-mono mb-2 px-1">
        <span>{rangeStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>{rangeEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
      </div>

      {/* Track */}
      <div className="relative h-auto min-h-[120px] bg-surface border border-border rounded p-4">
        {/* Today marker */}
        <div
          className="absolute top-0 bottom-0 w-px bg-accent/40"
          style={{ left: `${Math.min(100, Math.max(0, nowPosition))}%` }}
        >
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] text-accent font-mono">
            today
          </span>
        </div>

        {/* Goal bars */}
        <div className="space-y-3 relative z-10">
          {goalsWithDeadline.map((goal) => {
            const deadlineTime = new Date(goal.deadline!).getTime();
            const position = ((deadlineTime - rangeStart.getTime()) / totalRange) * 100;
            const progressWidth = (goal.progress / 100) * position;

            return (
              <div key={goal.id} className="flex items-center gap-3">
                <span className="text-[10px] text-muted font-mono shrink-0 whitespace-nowrap">
                  {goal.title}
                </span>
                <div className="flex-1 relative h-5">
                  {/* Background track */}
                  <div className="absolute inset-y-0 left-0 bg-border/50 rounded-full" style={{ width: `${position}%` }} />
                  {/* Progress fill */}
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full opacity-60 ${statusColors[goal.status]?.split(' ')[0] || 'bg-accent2'}`}
                    style={{ width: `${progressWidth}%` }}
                  />
                  {/* Deadline marker */}
                  <div
                    className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 ${statusColors[goal.status]} bg-surface`}
                    style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
                  />
                </div>
                <span className="text-[10px] font-mono text-heading w-8 text-right shrink-0">{goal.progress}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
