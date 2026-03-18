import {
  Activity,
  FolderKanban,
  Target,
  TrendingUp,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Circle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDashboardStats, useUpcomingDeadlines, useActivityByDate, useLatestInsight } from '../hooks/useDashboard';
import { useProjects } from '../hooks/useProjects';
import ContributionGraph from '../components/ContributionGraph';

const statusColors: Record<string, string> = {
  at_risk: 'text-accent',
  in_progress: 'text-accent2',
  active: 'text-accent2',
  not_started: 'text-muted',
};

const statusIcons: Record<string, typeof Circle> = {
  at_risk: AlertTriangle,
  complete: CheckCircle,
};

export default function DashboardPage() {
  const { stats, loading: statsLoading } = useDashboardStats();
  const { projects } = useProjects();
  const { deadlines, loading: deadlinesLoading } = useUpcomingDeadlines();
  const { data: activityData } = useActivityByDate();
  const { insight, loading: insightLoading } = useLatestInsight();

  const statCards = [
    { label: 'Active Projects', value: statsLoading ? '…' : String(stats.activeProjects), icon: FolderKanban, color: 'text-accent' },
    { label: 'Goals Tracked', value: statsLoading ? '…' : String(stats.goalsTracked), icon: Target, color: 'text-accent2' },
    { label: 'Events This Week', value: statsLoading ? '…' : String(stats.eventsThisWeek), icon: Activity, color: 'text-accent3' },
    { label: 'On-Track Rate', value: statsLoading ? '…' : stats.onTrackRate !== null ? `${stats.onTrackRate}%` : '—', icon: TrendingUp, color: 'text-heading' },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">
          Dashboard
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
          Project Overview
        </h1>
        <p className="text-sm text-muted mt-1">
          Everything your team is working on — in one place.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border mb-10">
        {statCards.map((s) => (
          <div key={s.label} className="bg-surface p-6 hover:bg-surface2 transition-colors">
            <div className="flex items-center gap-2 mb-3">
              <s.icon size={14} className={s.color} />
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted">
                {s.label}
              </span>
            </div>
            <div className="font-sans text-2xl font-bold text-heading">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Quick Project Access */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-border border border-border mb-10">
          {projects.slice(0, 4).map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.id}`}
              className="bg-surface p-4 hover:bg-surface2 transition-colors group"
            >
              <div className="flex items-center gap-2">
                <FolderKanban size={12} className="text-accent" />
                <span className="text-xs text-heading font-sans font-semibold truncate group-hover:text-accent transition-colors">
                  {p.name}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent Activity + AI Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-px">
        {/* Contribution heatmap */}
        <div className="lg:col-span-2 bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Clock size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">Recent Activity</h2>
          </div>
          {activityData.length > 0 ? (
            <ContributionGraph data={activityData} />
          ) : (
            <div className="py-8 text-center">
              <p className="text-xs text-muted tracking-wide">
                Import commits or events from a connected repo to see activity here.
              </p>
            </div>
          )}
        </div>

        {/* AI Summary */}
        <div className="bg-surface p-6 border-l border-border">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">AI Summary</h2>
          </div>

          {insightLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-3 bg-border/50 rounded animate-pulse" />
              ))}
            </div>
          ) : insight ? (
            <div className="space-y-4">
              {/* Project label */}
              <Link
                to={`/projects/${insight.project_id}`}
                className="text-[10px] tracking-widest uppercase text-accent hover:underline font-mono"
              >
                {insight.project_name}
              </Link>

              {/* Status */}
              <p className="text-xs text-heading leading-relaxed">{insight.status}</p>

              {/* Next Steps */}
              {insight.next_steps.length > 0 && (
                <div>
                  <p className="text-[10px] tracking-[0.15em] uppercase text-muted mb-1.5">Next Steps</p>
                  <ul className="space-y-1">
                    {insight.next_steps.slice(0, 3).map((step, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-accent2 mt-0.5 shrink-0">›</span>
                        <span className="text-[11px] text-muted leading-snug">{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Generated at + provider */}
              <p className="text-[9px] text-muted/50 font-mono pt-1">
                {new Date(insight.generated_at).toLocaleDateString()} · {insight.provider}
              </p>
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-xs text-muted tracking-wide">
                Open a project and click "Generate" in the AI Insights panel for analysis.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Target size={14} className="text-accent2" />
          <h2 className="font-sans text-base font-bold text-heading">Upcoming Deadlines</h2>
        </div>

        {deadlinesLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-border/40 rounded animate-pulse" />
            ))}
          </div>
        ) : deadlines.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-xs text-muted tracking-wide">
              No upcoming deadlines in the next 3 weeks. Add goal deadlines in your projects.
            </p>
          </div>
        ) : (
          <div className="space-y-px border border-border bg-border">
            {deadlines.map((d) => {
              const daysLeft = Math.ceil(
                (new Date(d.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
              );
              const overdue = daysLeft < 0;
              const urgent = !overdue && daysLeft <= 3;
              const StatusIcon = statusIcons[d.status] ?? Circle;
              return (
                <Link
                  key={d.id}
                  to={`/projects/${d.project_id}`}
                  className="flex items-center gap-3 bg-surface px-4 py-3 hover:bg-surface2 transition-colors group"
                >
                  <StatusIcon
                    size={13}
                    className={statusColors[d.status] ?? 'text-muted'}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-heading font-sans font-semibold truncate">
                      {d.title}
                    </p>
                    <p className="text-[10px] text-muted truncate">{d.projectName}</p>
                  </div>
                  {/* Progress bar */}
                  <div className="w-16 h-1.5 bg-border rounded-full overflow-hidden shrink-0">
                    <div
                      className="h-full bg-accent2 rounded-full"
                      style={{ width: `${d.progress}%` }}
                    />
                  </div>
                  <span
                    className={`text-[10px] font-mono shrink-0 ${
                      overdue ? 'text-danger' : urgent ? 'text-accent' : 'text-muted'
                    }`}
                  >
                    {overdue
                      ? `${Math.abs(daysLeft)}d overdue`
                      : daysLeft === 0
                      ? 'Due today'
                      : `${daysLeft}d left`}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
