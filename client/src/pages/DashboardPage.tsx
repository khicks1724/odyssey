import { useState, useEffect, useRef, useCallback, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  Target,
  TrendingUp,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle,
  Circle,
  GitCommitHorizontal,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDashboardStats, useActivityByDate, useLatestInsight, useRecentCommits, useDashboardHoverDetails, useMyAssignedTasks, useDashboardAISummary } from '../hooks/useDashboard';
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

const STATUS_LABELS: Record<string, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  in_review: 'In Review',
  complete: 'Complete',
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
        <span className="text-[10px] tracking-[0.2em] uppercase text-muted">{label}</span>
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
  const { data: activityData, loading: activityLoading } = useActivityByDate();
  const { insight, loading: insightLoading } = useLatestInsight();
  const { commits: recentCommits, loading: commitsLoading } = useRecentCommits();
  const { tasks: hoverTasks, events: hoverEvents, breakdown, loading: hoverLoading } = useDashboardHoverDetails();
  const { tasks: myTasks, loading: myTasksLoading } = useMyAssignedTasks();
  const { summary: aiSummary, loading: aiSummaryLoading, error: aiSummaryError, generate: generateAISummary } = useDashboardAISummary();
  const myTasksViewportRef = useRef<HTMLDivElement | null>(null);
  const myTasksDragRef = useRef<{ pointerId: number | null; startX: number; startScrollLeft: number; moved: boolean }>({
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    moved: false,
  });
  const myTasksSuppressClickRef = useRef(false);
  const [canScrollMyTasksLeft, setCanScrollMyTasksLeft] = useState(false);
  const [canScrollMyTasksRight, setCanScrollMyTasksRight] = useState(false);
  const [isMyTasksDragging, setIsMyTasksDragging] = useState(false);

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
        setInsightGitlabRepos(data?.config ? getGitLabRepoPaths(data.config as GitLabIntegrationConfig) : []);
      });
  }, [insight?.project_id]);

  useEffect(() => {
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length === 0) { setProjectMemberCounts({}); return; }
    supabase
      .from('project_members')
      .select('project_id')
      .in('project_id', projectIds)
      .then(({ data, error }) => {
        if (error || !data) return;
        const counts = data.reduce<Record<string, number>>((acc, row) => {
          const pid = row.project_id as string;
          acc[pid] = (acc[pid] ?? 0) + 1;
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

  const statCards = [
    { label: 'Active Projects', value: statsLoading ? '…' : String(stats.activeProjects), icon: FolderKanban, color: 'text-accent' },
    { label: 'Tasks Tracked', value: statsLoading ? '…' : String(stats.goalsTracked), icon: Target, color: 'text-accent2' },
    { label: 'Events This Week', value: statsLoading ? '…' : String(stats.eventsThisWeek), icon: Activity, color: 'text-accent3' },
    { label: 'On-Track Rate', value: statsLoading ? '…' : stats.onTrackRate !== null ? `${stats.onTrackRate}%` : '—', icon: TrendingUp, color: 'text-heading' },
  ];

  const updateMyTasksScrollState = useCallback(() => {
    const viewport = myTasksViewportRef.current;
    if (!viewport) {
      setCanScrollMyTasksLeft(false);
      setCanScrollMyTasksRight(false);
      return;
    }
    setCanScrollMyTasksLeft(viewport.scrollLeft > 4);
    setCanScrollMyTasksRight(viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 4);
  }, []);

  const getMyTasksScrollStep = useCallback(() => {
    const viewport = myTasksViewportRef.current;
    if (!viewport) return 0;
    return Math.max(1, Math.round(viewport.clientWidth / 5));
  }, []);

  const scrollMyTasksByStep = useCallback((direction: 'left' | 'right') => {
    const viewport = myTasksViewportRef.current;
    if (!viewport) return;
    const amount = getMyTasksScrollStep();
    viewport.scrollBy({
      left: direction === 'right' ? amount : -amount,
      behavior: 'smooth',
    });
  }, [getMyTasksScrollStep]);

  const finishMyTasksDrag = useCallback((pointerId?: number) => {
    const viewport = myTasksViewportRef.current;
    if (viewport != null && pointerId != null && viewport.hasPointerCapture(pointerId)) {
      viewport.releasePointerCapture(pointerId);
    }
    const moved = myTasksDragRef.current.moved;
    myTasksDragRef.current = {
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
      moved: false,
    };
    setIsMyTasksDragging(false);
    if (moved) {
      window.setTimeout(() => {
        myTasksSuppressClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleMyTasksPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const viewport = myTasksViewportRef.current;
    if (!viewport) return;
    myTasksSuppressClickRef.current = false;
    myTasksDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: viewport.scrollLeft,
      moved: false,
    };
    setIsMyTasksDragging(false);
    viewport.setPointerCapture(event.pointerId);
  }, []);

  const handleMyTasksPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = myTasksViewportRef.current;
    const dragState = myTasksDragRef.current;
    if (!viewport || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    if (!dragState.moved && Math.abs(deltaX) < 6) return;
    event.preventDefault();
    if (!dragState.moved) {
      dragState.moved = true;
      myTasksSuppressClickRef.current = true;
      setIsMyTasksDragging(true);
    }
    viewport.scrollLeft = dragState.startScrollLeft - deltaX;
  }, []);

  const handleMyTasksPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (myTasksDragRef.current.pointerId !== event.pointerId) return;
    finishMyTasksDrag(event.pointerId);
  }, [finishMyTasksDrag]);

  useEffect(() => {
    updateMyTasksScrollState();
    const viewport = myTasksViewportRef.current;
    if (!viewport) return;
    const handleScroll = () => updateMyTasksScrollState();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateMyTasksScrollState);
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateMyTasksScrollState);
    };
  }, [myTasks.length, updateMyTasksScrollState]);

  return (
    <div className="app-page-width app-page-width--wide p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">Dashboard</p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">At A Glance</h1>
        <p className="text-sm text-muted mt-1">Everything you are working on, in one place.</p>
      </div>

      {projects.length === 0 && (
        <div className="border border-accent/20 bg-accent/5 p-6 mb-10">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-[10px] tracking-[0.18em] uppercase text-accent font-mono mb-2">Getting Started</p>
              <h2 className="font-sans text-lg font-bold text-heading">This account does not have any projects yet.</h2>
              <p className="text-sm text-muted mt-2 max-w-2xl">
                Create your first project or join an existing one to unlock the rest of the workspace views.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                to="/projects/new"
                className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-semibold tracking-wider uppercase hover:bg-accent/10 transition-colors rounded-md"
              >
                <FolderKanban size={13} />
                New Project
              </Link>
              <Link
                to="/projects"
                className="inline-flex items-center gap-2 px-4 py-2 border border-border text-muted text-xs font-semibold tracking-wider uppercase hover:bg-surface2 hover:text-heading transition-colors rounded-md"
              >
                <Activity size={13} />
                Open Projects
              </Link>
            </div>
          </div>
        </div>
      )}

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
                <Link key={project.id} to={`/projects/${project.id}`}
                  className="block w-full border border-border bg-surface2/60 rounded-md px-3 py-2.5 hover:bg-surface2 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-xs text-heading font-sans font-semibold leading-snug truncate hover:text-accent">{project.name}</p>
                    <span className="shrink-0 text-[9px] font-mono text-muted">{projectMemberCounts[project.id] ?? 1}</span>
                  </div>
                  {project.description && <p className="text-[10px] text-muted mt-1.5 line-clamp-2 leading-relaxed">{project.description}</p>}
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
                <Link key={task.id} to={`/projects/${task.projectId}`} state={{ openTab: 'goals', editGoalId: task.id }}
                  className="block w-full border border-border bg-surface2/60 rounded px-3 py-2 hover:bg-surface2 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-heading font-sans font-semibold leading-snug">{task.title}</p>
                    <span className="text-[10px] font-mono text-muted shrink-0">{task.progress}%</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 truncate">{task.projectName}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {task.category && <span className="text-[9px] px-1.5 py-0.5 border border-white/20 bg-white/5 rounded text-muted font-mono uppercase">{task.category}</span>}
                    {task.loe && <span className="text-[9px] px-1.5 py-0.5 border border-accent2/50 bg-accent2/10 rounded text-accent2 font-mono uppercase">{task.loe}</span>}
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
                <Link key={event.id} to={`/projects/${event.projectId}`} state={{ openTab: 'activity' }}
                  className="block w-full border border-border bg-surface2/60 rounded px-3 py-2 hover:bg-surface2 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs text-heading font-sans font-semibold leading-snug">{event.title}</p>
                    <span className="text-[9px] font-mono text-muted shrink-0">{new Date(event.occurredAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-[10px] text-muted mt-1 truncate">{event.projectName}</p>
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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-muted font-mono">Complete {breakdown.complete}</span>
            <span className="text-[10px] text-muted font-mono">In Progress {breakdown.inProgress}</span>
            <span className="text-[10px] text-muted font-mono">Not Started {breakdown.notStarted}</span>
          </div>
        </StatHoverCard>
      </div>

      {/* ── My Assigned Tasks ─────────────────────────────────────── */}
      <div className="border border-border bg-surface p-6 mb-px">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-accent2" />
            <h2 className="font-sans text-base font-bold text-heading">My Tasks</h2>
            {!myTasksLoading && (
              <span className="text-[10px] text-muted font-mono bg-surface2 px-1.5 py-0.5 rounded">{myTasks.length}</span>
            )}
          </div>
        </div>

        {myTasksLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 grow basis-0 bg-border/40 rounded animate-pulse" />)}
          </div>
        ) : myTasks.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-xs text-muted tracking-wide">No tasks assigned to you. Tasks assigned to you across all projects appear here.</p>
          </div>
        ) : (
          <div className="relative">
            {canScrollMyTasksLeft && (
              <button
                type="button"
                onClick={() => scrollMyTasksByStep('left')}
                className="absolute left-0 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 border border-border bg-surface/92 p-1.5 text-muted shadow-sm backdrop-blur-sm transition-colors hover:text-heading"
                aria-label="Scroll tasks left"
              >
                <ChevronLeft size={14} />
              </button>
            )}
            {canScrollMyTasksRight && (
              <button
                type="button"
                onClick={() => scrollMyTasksByStep('right')}
                className="absolute right-0 top-1/2 z-10 translate-x-1/2 -translate-y-1/2 border border-border bg-surface/92 p-1.5 text-muted shadow-sm backdrop-blur-sm transition-colors hover:text-heading"
                aria-label="Scroll tasks right"
              >
                <ChevronRight size={14} />
              </button>
            )}
            <div
              ref={myTasksViewportRef}
              className={`overflow-hidden ${isMyTasksDragging ? 'cursor-grabbing' : 'cursor-grab'} select-none`}
              onPointerDown={handleMyTasksPointerDown}
              onPointerMove={handleMyTasksPointerMove}
              onPointerUp={handleMyTasksPointerUp}
              onPointerCancel={handleMyTasksPointerUp}
              style={{ touchAction: 'pan-y' }}
            >
              <div className="flex gap-px border border-border bg-border">
                {myTasks.map((task) => {
                  const daysLeft = task.deadline
                    ? Math.ceil((new Date(task.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                    : null;
                  const overdue = daysLeft !== null && daysLeft < 0;
                  const urgent = daysLeft !== null && !overdue && daysLeft <= 3;
                  const StatusIcon = statusIcons[task.status] ?? Circle;
                  return (
                    <Link
                      key={task.id}
                      to={`/projects/${task.projectId}`}
                      state={{ openTab: 'goals', editGoalId: task.id }}
                      onClick={(event) => {
                        if (!myTasksSuppressClickRef.current) return;
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      draggable={false}
                      className="bg-surface px-4 py-3 transition-colors hover:bg-surface2 flex shrink-0 flex-col gap-2 group"
                      style={{ flex: '0 0 calc((100% - 4px) / 5)' }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <StatusIcon size={11} className={`${statusColors[task.status] ?? 'text-muted'} shrink-0 mt-0.5`} />
                        {daysLeft !== null && (
                          <span className={`text-[9px] font-mono shrink-0 ${overdue ? 'text-accent' : urgent ? 'text-accent' : 'text-muted'}`}>
                            {overdue ? `${Math.abs(daysLeft)}d overdue` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-heading font-semibold leading-snug line-clamp-2 group-hover:text-accent transition-colors">{task.title}</p>
                      <p className="text-[10px] text-muted truncate">{task.projectName}</p>
                      <div className="w-full h-1 bg-border rounded-full overflow-hidden">
                        <div className="h-full bg-accent2 rounded-full" style={{ width: `${task.progress}%` }} />
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {task.category && (
                          <span className="text-[9px] px-1.5 py-0.5 border border-white/20 bg-white/5 rounded text-muted font-mono uppercase">{task.category}</span>
                        )}
                        {task.loe && (
                          <span className="text-[9px] px-1.5 py-0.5 border border-accent2/50 bg-accent2/10 rounded text-accent2 font-mono uppercase">{task.loe}</span>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── AI Summary ────────────────────────────────────────────── */}
      <div className="border border-border border-t-0 bg-surface p-6 mb-px">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h2 className="font-sans text-base font-bold text-heading">AI Summary</h2>
          </div>
          <button
            type="button"
            onClick={() => void generateAISummary()}
            disabled={aiSummaryLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-[10px] font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded disabled:opacity-50"
          >
            <RefreshCw size={10} className={aiSummaryLoading ? 'animate-spin' : ''} />
            {aiSummaryLoading ? 'Generating…' : aiSummary ? 'Regenerate' : 'Generate'}
          </button>
        </div>
        {aiSummaryError && <p className="text-xs text-accent font-mono mb-2">{aiSummaryError}</p>}
        {aiSummary ? (
          <div>
            <p className="text-sm text-heading leading-relaxed">{aiSummary.summary}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[9px] font-mono text-muted/50">
              <p>Generated {new Date(aiSummary.generatedAt).toLocaleString()}</p>
              {(aiSummary.model ?? aiSummary.provider) && (
                <span className="rounded border border-border px-1.5 py-0.5 text-muted/70">
                  {aiSummary.model ?? aiSummary.provider}
                </span>
              )}
            </div>
          </div>
        ) : !aiSummaryLoading && (
          <p className="text-xs text-muted">Click Generate for a personalized summary of your projects and tasks.</p>
        )}
      </div>

      {/* ── Recent Activity + Commits ─────────────────────────────── */}
      <div className="border border-border border-t-0 bg-surface p-6 mb-px">
        <div className="flex items-center gap-2 mb-6">
          <Clock size={14} className="text-accent" />
          <h2 className="font-sans text-base font-bold text-heading">Recent Activity</h2>
        </div>
        <div className="pr-6 min-h-[164px]">
          {activityLoading ? (
            <div className="animate-pulse">
              <div className="h-3 w-40 rounded bg-border/50 mb-4" />
              <div className="h-28 rounded-md bg-border/45" />
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
              {[1,2,3].map((i) => <div key={i} className="h-8 bg-border/40 rounded animate-pulse" />)}
            </div>
          ) : recentCommits.length === 0 ? (
            <p className="text-xs text-muted/60 py-2">No commits found. Connect a GitHub or GitLab repo in project settings.</p>
          ) : (
            <div className="space-y-px">
              {recentCommits.slice(0, 12).map((c, i) => {
                const ms = Date.now() - new Date(c.date).getTime();
                const h = Math.floor(ms / 3600000);
                const d = Math.floor(h / 24);
                const ago = d > 0 ? `${d}d ago` : h > 0 ? `${h}h ago` : 'just now';
                return (
                  <div key={i} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
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

      {/* Quick Project Access */}
      {projects.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-px bg-border border border-border border-t-0">
          {projects.slice(0, 4).map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`}
              className="bg-surface p-4 hover:bg-surface2 transition-colors group">
              <div className="flex items-center gap-2">
                <FolderKanban size={12} className="text-accent" />
                <span className="text-xs text-heading font-sans font-semibold truncate group-hover:text-accent transition-colors">{p.name}</span>
              </div>
              <div className="mt-2 pl-5">
                <p className="text-[10px] text-muted font-mono">{projectMemberCounts[p.id] ?? 1} member{(projectMemberCounts[p.id] ?? 1) === 1 ? '' : 's'}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

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
    </div>
  );
}
