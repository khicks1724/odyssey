import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Activity,
  Users,
  Target,
  Github,
  Sparkles,
  BarChart3,
  Plus,
  Trash2,
  ArrowLeft,
} from 'lucide-react';
import { useProject } from '../hooks/useProjects';
import { useGoals } from '../hooks/useGoals';
import { useEvents } from '../hooks/useEvents';
import GoalCard from '../components/GoalCard';
import ActivityFeed from '../components/ActivityFeed';
import Timeline from '../components/Timeline';
import StatusBadge from '../components/StatusBadge';
import Modal, { useModal } from '../components/Modal';

const tabs = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'members', label: 'Members', icon: Users },
] as const;

type TabId = (typeof tabs)[number]['id'];

export default function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { project, loading: projectLoading } = useProject(projectId);
  const { goals, createGoal, updateGoal, deleteGoal } = useGoals(projectId);
  const { events, loading: eventsLoading } = useEvents(projectId);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const goalModal = useModal();
  const [newGoalTitle, setNewGoalTitle] = useState('');
  const [newGoalDeadline, setNewGoalDeadline] = useState('');

  if (projectLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto animate-pulse">
        <div className="h-4 bg-border rounded w-32 mb-4" />
        <div className="h-8 bg-border rounded w-64 mb-2" />
        <div className="h-4 bg-border rounded w-96" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-8 max-w-6xl mx-auto text-center py-20">
        <p className="text-muted text-sm mb-4">Project not found</p>
        <button onClick={() => navigate('/projects')} className="text-accent text-xs hover:underline">
          ← Back to Projects
        </button>
      </div>
    );
  }

  const activeGoals = goals.filter((g) => g.status === 'active' || g.status === 'at_risk');
  const completedGoals = goals.filter((g) => g.status === 'complete');
  const overallProgress = goals.length > 0
    ? Math.round(goals.reduce((sum, g) => sum + g.progress, 0) / goals.length)
    : 0;

  const projectStatus = goals.some((g) => g.status === 'at_risk') ? 'at_risk'
    : goals.every((g) => g.status === 'complete') && goals.length > 0 ? 'complete'
    : 'on_track';

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGoalTitle.trim()) return;
    await createGoal({ title: newGoalTitle, deadline: newGoalDeadline || undefined });
    setNewGoalTitle('');
    setNewGoalDeadline('');
    goalModal.onClose();
  };

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Back button */}
      <button
        onClick={() => navigate('/projects')}
        className="flex items-center gap-1 text-muted hover:text-heading text-xs mb-4 transition-colors"
      >
        <ArrowLeft size={12} /> Back to Projects
      </button>

      {/* Project Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
            {project.name}
          </h1>
          <StatusBadge status={projectStatus} size="md" />
        </div>
        {project.description && (
          <p className="text-sm text-muted">{project.description}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-px border border-border bg-border mb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-3 bg-surface text-xs tracking-wider uppercase transition-colors first:rounded-tl last:rounded-tr ${
              activeTab === tab.id
                ? 'text-heading bg-surface2 font-medium'
                : 'text-muted hover:text-heading hover:bg-surface2'
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <>
          {/* Stats + Integrations + AI */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-8">
            <div className="bg-surface p-6">
              <h3 className="font-sans text-sm font-bold text-heading mb-4">Project Status</h3>
              <div className="space-y-3">
                <StatRow label="Goals" value={`${completedGoals.length} / ${goals.length}`} />
                <StatRow label="Overall Progress" value={`${overallProgress}%`} />
                <StatRow label="Events" value={String(events.length)} />
              </div>
            </div>
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
            <div className="bg-surface p-6">
              <div className="flex items-center gap-2 mb-4">
                <Sparkles size={14} className="text-accent" />
                <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                {events.length > 0
                  ? 'AI analysis will be available soon. Add more activity to unlock insights.'
                  : 'Connect integrations and add activity to unlock AI-powered project analysis.'}
              </p>
            </div>
          </div>

          {/* Timeline */}
          <div className="border border-border bg-surface p-6 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Target size={14} className="text-accent2" />
              <h3 className="font-sans text-sm font-bold text-heading">Timeline</h3>
            </div>
            <Timeline goals={goals} />
          </div>

          {/* Recent Activity */}
          <div className="border border-border bg-surface p-6">
            <div className="flex items-center gap-2 mb-6">
              <Activity size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">Recent Activity</h3>
            </div>
            <ActivityFeed
              events={events.slice(0, 10)}
              loading={eventsLoading}
              emptyMessage="No activity yet. Connect a GitHub repo to start."
            />
          </div>
        </>
      )}

      {activeTab === 'activity' && (
        <div className="border border-border bg-surface p-6">
          <ActivityFeed
            events={events}
            loading={eventsLoading}
            emptyMessage="No activity yet. Connect a GitHub repo to start tracking."
          />
        </div>
      )}

      {activeTab === 'goals' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-sans text-sm font-bold text-heading">
              Goals ({goals.length})
            </h3>
            <button
              onClick={goalModal.onOpen}
              className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
            >
              <Plus size={14} />
              Add Goal
            </button>
          </div>

          {goals.length === 0 ? (
            <div className="border border-border bg-surface p-12 text-center">
              <Target size={32} className="text-border mx-auto mb-3" />
              <p className="text-sm text-muted mb-4">No goals yet. Add your first goal to start tracking progress.</p>
              <button
                onClick={goalModal.onOpen}
                className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md"
              >
                <Plus size={14} />
                Add Goal
              </button>
            </div>
          ) : (
            <div className="space-y-px border border-border bg-border">
              {goals.map((goal) => (
                <div key={goal.id} className="relative group">
                  <GoalCard
                    goal={goal}
                    onUpdateProgress={(id, progress) => updateGoal(id, { progress })}
                    onUpdateStatus={(id, status) => updateGoal(id, { status })}
                  />
                  <button
                    onClick={() => deleteGoal(goal.id)}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 text-muted hover:text-danger transition-all"
                    title="Delete goal"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add Goal Modal */}
          <Modal open={goalModal.open} onClose={goalModal.onClose} title="Add Goal">
            <form onSubmit={handleCreateGoal} className="space-y-4">
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Title</label>
                <input
                  type="text"
                  value={newGoalTitle}
                  onChange={(e) => setNewGoalTitle(e.target.value)}
                  required
                  placeholder="e.g. Complete API integration"
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">Deadline (optional)</label>
                <input
                  type="date"
                  value={newGoalDeadline}
                  onChange={(e) => setNewGoalDeadline(e.target.value)}
                  className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
                >
                  Create Goal
                </button>
                <button
                  type="button"
                  onClick={goalModal.onClose}
                  className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
                >
                  Cancel
                </button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {activeTab === 'members' && (
        <div className="border border-border bg-surface p-6">
          <div className="flex items-center gap-2 mb-6">
            <Users size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">Team Members</h3>
          </div>
          <div className="py-4">
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-xs text-accent font-bold">You</span>
              </div>
              <div>
                <div className="text-xs text-heading font-medium">Project Owner</div>
                <div className="text-[10px] text-muted">Member since project creation</div>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted mt-4">
            Member invitation will be available in a future update.
          </p>
        </div>
      )}
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
