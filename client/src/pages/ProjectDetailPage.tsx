import { useParams } from 'react-router-dom';
import {
  Activity,
  Users,
  Target,
  Github,
  Sparkles,
  BarChart3,
} from 'lucide-react';

const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'members', label: 'Members', icon: Users },
] as const;

export default function ProjectDetailPage() {
  const { projectId } = useParams();

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Project Header */}
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.25em] uppercase text-muted mb-2 font-mono">
          Project · {projectId?.slice(0, 8)}
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight mb-1">
          Project Name
        </h1>
        <p className="text-sm text-muted">Project description will appear here</p>
      </div>

      {/* Tabs placeholder */}
      <div className="flex gap-px border border-border bg-border mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className="flex items-center gap-2 px-5 py-3 bg-surface text-xs tracking-wider uppercase text-muted hover:text-heading hover:bg-surface2 transition-colors first:rounded-tl last:rounded-tr"
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-8">
        {/* Status */}
        <div className="bg-surface p-6">
          <h3 className="font-sans text-sm font-bold text-heading mb-4">Project Status</h3>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-accent3" />
            <span className="text-xs text-accent3 font-sans font-semibold tracking-wider uppercase">
              On Track
            </span>
          </div>
          <div className="space-y-3">
            <StatRow label="Goals" value="0 / 0" />
            <StatRow label="Events" value="0" />
            <StatRow label="Members" value="1" />
          </div>
        </div>

        {/* Integrations */}
        <div className="bg-surface p-6">
          <h3 className="font-sans text-sm font-bold text-heading mb-4">Integrations</h3>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <Github size={16} className="text-heading" />
              <div>
                <div className="text-xs text-heading font-medium">GitHub</div>
                <div className="text-[10px] text-muted">Not connected</div>
              </div>
            </div>
          </div>
        </div>

        {/* AI Insights */}
        <div className="bg-surface p-6">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={14} className="text-accent" />
            <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
          </div>
          <p className="text-xs text-muted leading-relaxed">
            Connect integrations and add activity to unlock AI-powered project analysis.
          </p>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-6">
          <Activity size={14} className="text-accent" />
          <h3 className="font-sans text-sm font-bold text-heading">Recent Activity</h3>
        </div>
        <div className="py-8 text-center">
          <p className="text-xs text-muted tracking-wide">
            No activity yet. Connect a GitHub repo to start.
          </p>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-heading font-sans font-semibold">{value}</span>
    </div>
  );
}
