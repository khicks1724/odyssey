import {
  Activity,
  FolderKanban,
  Target,
  TrendingUp,
  Clock,
  Sparkles,
} from 'lucide-react';

const stats = [
  { label: 'Active Projects', value: '0', icon: FolderKanban, color: 'text-accent' },
  { label: 'Goals Tracked', value: '0', icon: Target, color: 'text-accent2' },
  { label: 'Events This Week', value: '0', icon: Activity, color: 'text-accent3' },
  { label: 'On-Track Rate', value: '—', icon: TrendingUp, color: 'text-heading' },
];

export default function DashboardPage() {
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
        {stats.map((s) => (
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

      {/* Recent Activity + AI Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border">
        {/* Activity Feed */}
        <div className="lg:col-span-2 bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Clock size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">Recent Activity</h2>
          </div>
          <div className="space-y-3">
            <EmptyState message="Connect a GitHub repo to see activity here" />
          </div>
        </div>

        {/* AI Summary */}
        <div className="bg-surface p-6 border-l border-border">
          <div className="flex items-center gap-2 mb-6">
            <Sparkles size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">AI Summary</h2>
          </div>
          <div className="text-xs text-muted leading-relaxed">
            <EmptyState message="AI insights will appear once your project has activity data" />
          </div>
        </div>
      </div>

      {/* Upcoming Deadlines */}
      <div className="mt-px border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Target size={14} className="text-accent2" />
          <h2 className="font-sans text-base font-bold text-heading">Upcoming Deadlines</h2>
        </div>
        <EmptyState message="Create a project and set goals to track deadlines" />
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-xs text-muted tracking-wide">{message}</p>
    </div>
  );
}
