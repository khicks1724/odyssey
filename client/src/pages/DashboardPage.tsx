import { useState, useEffect, type ReactNode } from 'react';
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
  GitCommitHorizontal,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDashboardStats, useUpcomingDeadlines, useActivityByDate, useLatestInsight, useRecentCommits, useDashboardHoverDetails } from '../hooks/useDashboard';
import { useProjects } from '../hooks/useProjects';
import { getSortMode, sortProjects } from '../lib/project-sort';
import ContributionGraph from '../components/ContributionGraph';
import MarkdownWithFileLinks from '../components/MarkdownWithFileLinks';
import FilePreviewModal from '../components/FilePreviewModal';
import RepoTreeModal from '../components/RepoTreeModal';
import { getGitLabRepoPaths, type GitLabIntegrationConfig } from '../lib/gitlab';
import { getGitHubRepos } from '../lib/github';
import { supabase } from '../lib/supabase';
import { useProjectFilePaths, type FileRef } from '../hooks/useProjectFilePaths';

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

function StatHoverCard({
  label,
  value,
  icon: Icon,
  color,
  children,
}: {
  label: string;
  value: string;
  icon: typeof FolderKanban;
  color: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative bg-surface p-6 hover:bg-surface2 transition-colors"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon size={14} className={color} />
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted">
          {label}
        </span>
      </div>
      <div className="font-sans text-2xl font-bold text-heading">{value}</div>

      <div className={`absolute left-3 right-3 top-full z-20 pt-2 transition-all duration-150 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
        <div className="border border-border bg-surface/95 backdrop-blur-md shadow-2xl p-4 rounded-lg max-h-80 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { stats, loading: statsLoading } = useDashboardStats();
  const { projects: rawProjects } = useProjects();
  const projects = sortProjects(rawProjects, getSortMode());
  const [projectMemberCounts, setProjectMemberCounts] = useState<Record<string, number>>({});
  const { deadlines, loading: deadlinesLoading } = useUpcomingDeadlines();
  const { data: activityData, loading: activityLoading } = useActivityByDate();
  const { insight, loading: insightLoading } = useLatestInsight();
  const { commits: recentCommits, loading: commitsLoading } = useRecentCommits();
  const { tasks: hoverTasks, events: hoverEvents, breakdown, loading: hoverLoading } = useDashboardHoverDetails();

  // Repo context for the insight's project
  const [insightGitlabRepos, setInsightGitlabRepos] = useState<string[]>([]);
  const [repoTreeTarget, setRepoTreeTarget] = useState<{ repo: string; type: 'github' | 'gitlab'; projectId?: string | null } | null>(null);
  const [previewFileRef, setPreviewFileRef] = useState<FileRef | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const insightProject = insight ? projects.find((p) => p.id === insight.project_id) ?? null : null;
  const { filePaths: insightFilePaths, fetchFileContent } = useProjectFilePaths(
    insight?.project_id ?? null,
    getGitHubRepos(insightProject),
    insightGitlabRepos,
  );

  useEffect(() => {
    if (!insight?.project_id) return;
    supabase
      .from('integrations')
      .select('config')
      .eq('project_id', insight.project_id)
      .eq('type', 'gitlab')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.config) {
          const cfg = data.config as GitLabIntegrationConfig;
          setInsightGitlabRepos(getGitLabRepoPaths(cfg));
        } else {
          setInsightGitlabRepos([]);
        }
      });
  }, [insight?.project_id]);

  useEffect(() => {
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) {
      setProjectMemberCounts({});
      return;
    }

    supabase
      .from('project_members')
      .select('project_id')
      .in('project_id', projectIds)
      .then(({ data, error }) => {
        if (error || !data) return;
        const counts = data.reduce<Record<string, number>>((acc, row) => {
          const projectId = row.project_id as string;
          acc[projectId] = (acc[projectId] ?? 0) + 1;
          return acc;
        }, {});
        setProjectMemberCounts(counts);
      });
  }, [projects]);

  const handleRepoClick = (repo: string, type: 'github' | 'gitlab') =>
    setRepoTreeTarget({ repo, type, projectId: type === 'gitlab' ? insight?.project_id ?? null : null });

  const handleFileClick = async (ref: FileRef) => {
    setPreviewFileRef(ref);
    setPreviewContent(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const content = await fetchFileContent(ref);
      setPreviewContent(content);
    } catch (err: any) {
      setPreviewError(err?.message ?? 'Failed to load file');
    } finally {
      setPreviewLoading(false);
    }
  };

  // Empty file map — dashboard has no local file preview

  const statCards = [
    { label: 'Active Projects', value: statsLoading ? '…' : String(stats.activeProjects), icon: FolderKanban, color: 'text-accent' },
    { label: 'Tasks Tracked', value: statsLoading ? '…' : String(stats.goalsTracked), icon: Target, color: 'text-accent2' },
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
          At A Glance
        </h1>
        <p className="text-sm text-muted mt-1">
          Everything you are working on, in one place.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border mb-10">
        <StatHoverCard {...statCards[0]}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.18em] uppercase text-muted">Active Projects</p>
            <span className="text-[10px] font-mono text-accent">{projects.length}</span>
          </div>
          {projects.length === 0 ? (
            <p className="text-xs text-muted">No active projects yet.</p>
          ) : (
            <div className="space-y-2">
              {projects.slice(0, 6).map((project) => (
                <Link
                  key={project.id}
                  to={`/projects/${project.id}`}
                  className="block w-full border border-border/70 bg-surface2/60 rounded-md px-3 py-2.5 hover:bg-surface2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-xs text-heading font-sans font-semibold leading-snug truncate hover:text-accent">{project.name}</p>
                    <span className="shrink-0 text-[9px] font-mono text-muted">
                      {projectMemberCounts[project.id] ?? 1}
                    </span>
                  </div>
                  {project.description && (
                    <p className="text-[10px] text-muted mt-1.5 line-clamp-2 leading-relaxed">{project.description}</p>
                  )}
                  <p className="text-[9px] text-muted/75 font-mono mt-2">
                    {new Date(project.created_at).toLocaleDateString()}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </StatHoverCard>

        <StatHoverCard {...statCards[1]}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.18em] uppercase text-muted">Tracked Tasks</p>
            <span className="text-[10px] font-mono text-accent2">{stats.goalsTracked}</span>
          </div>
          {hoverLoading ? (
            <p className="text-xs text-muted">Loading tasks…</p>
          ) : hoverTasks.length === 0 ? (
            <p className="text-xs text-muted">No tracked tasks yet.</p>
          ) : (
            <div className="space-y-2">
              {hoverTasks.slice(0, 5).map((task) => (
                <Link
                  key={task.id}
                  to={`/projects/${task.projectId}`}
                  state={{ openTab: 'goals', editGoalId: task.id }}
                  className="w-full text-left border border-border/70 bg-surface2/60 rounded px-3 py-2 hover:bg-surface2 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-heading font-sans font-semibold leading-snug">{task.title}</p>
                    <span className="text-[10px] font-mono text-muted shrink-0">{task.progress}%</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 truncate">
                    {task.assignees.length ? task.assignees.join(', ') : 'Unassigned'} · {task.projectName}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {task.category && <span className="text-[9px] px-1.5 py-0.5 border border-border rounded text-muted font-mono uppercase">{task.category}</span>}
                    {task.loe && <span className="text-[9px] px-1.5 py-0.5 border border-accent2/30 rounded text-accent2 font-mono uppercase">{task.loe}</span>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </StatHoverCard>

        <StatHoverCard {...statCards[2]}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.18em] uppercase text-muted">Events This Week</p>
            <span className="text-[10px] font-mono text-accent3">{stats.eventsThisWeek}</span>
          </div>
          {hoverLoading ? (
            <p className="text-xs text-muted">Loading events…</p>
          ) : hoverEvents.length === 0 ? (
            <p className="text-xs text-muted">No events logged in the last 7 days.</p>
          ) : (
            <div className="space-y-2">
              {hoverEvents.slice(0, 5).map((event) => (
                <Link key={event.id} to={`/projects/${event.projectId}`} state={{ openTab: 'activity' }} className="w-full text-left border border-border/70 bg-surface2/60 rounded px-3 py-2 hover:bg-surface2 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-heading font-sans font-semibold leading-snug">{event.title}</p>
                    <span className="text-[9px] font-mono text-muted shrink-0">{new Date(event.occurredAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 truncate">{event.projectName} · {event.source}/{event.eventType}</p>
                  {event.summary && <p className="text-[10px] text-muted/80 mt-1 line-clamp-2">{event.summary}</p>}
                </Link>
              ))}
            </div>
          )}
        </StatHoverCard>

        <StatHoverCard {...statCards[3]}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] tracking-[0.18em] uppercase text-muted">On-Track Breakdown</p>
            <span className="text-[10px] font-mono text-heading">{breakdown.onTrack}/{breakdown.total}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="border border-accent2/25 bg-accent2/8 rounded px-3 py-2">
              <p className="text-[9px] tracking-[0.16em] uppercase text-muted">On Track</p>
              <p className="text-lg font-sans font-bold text-accent2">{breakdown.onTrack}</p>
            </div>
            <div className="border border-accent/25 bg-accent/8 rounded px-3 py-2">
              <p className="text-[9px] tracking-[0.16em] uppercase text-muted">Needs Attention</p>
              <p className="text-lg font-sans font-bold text-accent">{breakdown.needsAttention}</p>
            </div>
          </div>
          <p className="text-[11px] text-muted leading-relaxed mb-3">
            {breakdown.total > 0
              ? `${breakdown.onTrack} of ${breakdown.total} tracked tasks are marked active or complete, with an average progress of ${breakdown.avgProgress}%.`
              : 'No tracked tasks yet, so the on-track rate is not calculated.'}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted font-mono">Complete {breakdown.complete}</span>
            <span className="text-[10px] text-muted font-mono">In Progress {breakdown.inProgress}</span>
            <span className="text-[10px] text-muted font-mono">Not Started {breakdown.notStarted}</span>
          </div>
          {breakdown.topCategories.length > 0 && (
            <p className="text-[10px] text-muted mt-2">
              Heaviest areas: {breakdown.topCategories.map((cat) => `${cat.name} (${cat.count})`).join(', ')}.
            </p>
          )}
        </StatHoverCard>
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
              <div className="mt-2 pl-5">
                <p className="text-[10px] text-muted font-mono">
                  Created {new Date(p.created_at).toLocaleDateString()}
                </p>
                <p className="text-[10px] text-muted font-mono">
                  {projectMemberCounts[p.id] ?? 1} member{(projectMemberCounts[p.id] ?? 1) === 1 ? '' : 's'}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent Activity + AI Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-px">
        {/* Contribution heatmap + recent commits */}
        <div className="lg:col-span-2 bg-surface p-6 overflow-hidden">
          <div className="flex items-center gap-2 mb-6">
            <Clock size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">Recent Activity</h2>
          </div>
          <div className="pr-6 min-h-[164px]">
            {activityLoading ? (
              <div className="animate-pulse">
                <div className="h-3 w-40 rounded bg-border/50 mb-4" />
                <div className="flex items-start gap-2">
                  <div className="w-8 space-y-2 pt-5">
                    <div className="h-2 rounded bg-border/40" />
                    <div className="h-2 rounded bg-border/40" />
                    <div className="h-2 rounded bg-border/40" />
                  </div>
                  <div className="flex-1">
                    <div className="h-28 rounded-md bg-border/45" />
                  </div>
                </div>
              </div>
            ) : (
              <ContributionGraph data={activityData} />
            )}
          </div>

          {/* Recent commits feed */}
          <div className="mt-6">
            <div className="flex items-center gap-2 mb-3">
              <GitCommitHorizontal size={12} className="text-muted" />
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted">Recent Commits</span>
            </div>
            {commitsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-8 bg-border/40 rounded animate-pulse" />)}
              </div>
            ) : recentCommits.length === 0 ? (
              <p className="text-xs text-muted/60 py-2">No commits found. Connect a GitHub or GitLab repo in project settings.</p>
            ) : (
              <div className="space-y-px">
                {recentCommits.slice(0, 12).map((c, i) => {
                  const ago = (() => {
                    const ms = Date.now() - new Date(c.date).getTime();
                    const h = Math.floor(ms / 3600000);
                    const d = Math.floor(h / 24);
                    if (d > 0) return `${d}d ago`;
                    if (h > 0) return `${h}h ago`;
                    return 'just now';
                  })();
                  return (
                    <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0 group">
                      <span className="font-mono text-[9px] text-accent/70 shrink-0 w-12">{c.sha}</span>
                      <span className="text-[11px] text-heading truncate flex-1">{c.message}</span>
                      <span className="text-[10px] text-muted/70 shrink-0 truncate max-w-[90px] hidden sm:block">{c.repo}</span>
                      <span className="text-[10px] text-muted shrink-0 truncate max-w-[70px] hidden md:block">{c.author}</span>
                      <span className="text-[9px] font-mono text-muted/60 shrink-0">{ago}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* AI Summary */}
        <div className="bg-surface p-6 border-l border-border overflow-hidden min-w-0">
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
              <div className="text-xs text-heading leading-relaxed break-words min-w-0">
                <MarkdownWithFileLinks
                  block
                  filePaths={insightFilePaths}
                  onFileClick={handleFileClick}
                  githubRepo={getGitHubRepos(insightProject)}
                  gitlabRepos={insightGitlabRepos}
                  onRepoClick={handleRepoClick}
                >
                  {insight.status}
                </MarkdownWithFileLinks>
              </div>

              {/* Next Steps */}
              {insight.next_steps.length > 0 && (
                <div>
                  <p className="text-[10px] tracking-[0.15em] uppercase text-muted mb-1.5">Next Steps</p>
                  <ul className="space-y-1">
                    {insight.next_steps.slice(0, 3).map((step, i) => (
                      <li key={i} className="flex items-start gap-1.5 min-w-0">
                        <span className="text-accent2 mt-0.5 shrink-0">›</span>
                        <span className="text-[11px] text-muted leading-snug break-words min-w-0">
                          <MarkdownWithFileLinks
                            filePaths={insightFilePaths}
                            onFileClick={handleFileClick}
                            githubRepo={getGitHubRepos(insightProject)}
                            gitlabRepos={insightGitlabRepos}
                            onRepoClick={handleRepoClick}
                          >
                            {step}
                          </MarkdownWithFileLinks>
                        </span>
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

      {repoTreeTarget && (
        <RepoTreeModal
          repo={repoTreeTarget.repo}
          type={repoTreeTarget.type}
          projectId={repoTreeTarget.projectId}
          onClose={() => setRepoTreeTarget(null)}
        />
      )}

      {previewFileRef && (
        <FilePreviewModal
          fileRef={previewFileRef}
          content={previewContent}
          loading={previewLoading}
          error={previewError}
          onClose={() => setPreviewFileRef(null)}
        />
      )}

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
              No upcoming deadlines in the next 3 weeks. Add task deadlines in your projects.
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
