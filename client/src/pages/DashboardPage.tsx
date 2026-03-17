import {
  Activity,
  FolderKanban,
  Target,
  TrendingUp,
  Clock,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDashboardStats } from '../hooks/useDashboard';
import { useRecentEvents } from '../hooks/useEvents';
import { useProjects } from '../hooks/useProjects';
import ActivityFeed from '../components/ActivityFeed';

export default function DashboardPage() {
  const { stats, loading: statsLoading } = useDashboardStats();
  const { events, loading: eventsLoading } = useRecentEvents(15);
  const { projects } = useProjects();

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border">
        {/* Activity Feed */}
        <div className="lg:col-span-2 bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Clock size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">Recent Activity</h2>
          </div>
          <ActivityFeed
            events={events}
            loading={eventsLoading}
            emptyMessage="Connect a GitHub repo to see activity here"
          />
        </div>

        {/* AI Summary */}
        <div className="bg-surface p-6 border-l border-border">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">AI Summary</h2>
          </div>
          <div className="text-xs text-muted leading-relaxed">
            <div className="py-8 text-center">
              <p className="text-xs text-muted tracking-wide">
                AI insights will appear once your project has activity data
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="mt-px border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Target size={14} className="text-accent2" />
          <h2 className="font-sans text-base font-bold text-heading">Upcoming Deadlines</h2>
        </div>
        <div className="py-8 text-center">
          <p className="text-xs text-muted tracking-wide">
            Create a project and set goals to track deadlines
          </p>
        </div>
      </div>
    </div>
  );
}
