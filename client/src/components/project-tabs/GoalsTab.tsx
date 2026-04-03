import React from 'react';
import {
  Sparkles,
  Plus,
  Loader2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  X,
  FileText,
  Check,
} from 'lucide-react';
import SearchPanel, { type SearchPanelHandle } from '../SearchPanel';
import FilterDropdown from '../FilterDropdown';
import type { Goal, OdysseyEvent, GoalDependency } from '../../types';
import { supabase } from '../../lib/supabase';
import { useAIAgent } from '../../lib/ai-agent';

type GoalStatus = Goal['status'];

const KANBAN_COLUMNS: { status: GoalStatus; label: string; color: string; accent: string }[] = [
  { status: 'not_started', label: 'Not Started', color: 'text-[#D94F4F]', accent: 'border-[#D94F4F]/40' },
  { status: 'in_progress', label: 'In Progress', color: 'text-[#D97E2A]', accent: 'border-[#D97E2A]/40' },
  { status: 'in_review',   label: 'In Review',   color: 'text-[#facc15]', accent: 'border-[#facc15]/40' },
  { status: 'complete',    label: 'Complete',     color: 'text-[#6DBE7D]', accent: 'border-[#6DBE7D]/40' },
];

const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isStaleComplete(goal: Goal): boolean {
  if (goal.status !== 'complete') return false;
  const updated = goal.updated_at ? new Date(goal.updated_at).getTime() : 0;
  return Date.now() - updated > STALE_MS;
}

interface GoalsKanbanProps {
  goals: Goal[];
  onUpdateStatus: (id: string, status: GoalStatus) => void;
  onEdit: (id: string) => void;
  onEditWithGuidance: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  getAssignee: (userId: string | null | undefined) => { user_id?: string; display_name: string | null; avatar_url: string | null } | null;
  goalDependencies?: GoalDependency[];
  timeLogTotals?: Map<string, number>;
}

// Import the icons used in the kanban inline since it's local
import {
  Clock,
  ExternalLink,
  Trash2,
  Link,
  Target,
} from 'lucide-react';

const barColors: Record<GoalStatus, string> = {
  not_started: 'bg-[#D94F4F]/50',
  in_progress: 'bg-[#D97E2A]/70',
  in_review:   'bg-[#facc15]/70',
  complete:    'bg-[#6DBE7D]/70',
};

const riskDotColor = (score: number | null | undefined) => {
  if (score == null) return null;
  if (score >= 0.75) return 'bg-red-500';
  if (score >= 0.5) return 'bg-orange-400';
  if (score >= 0.25) return 'bg-yellow-400';
  return 'bg-green-500';
};

function GoalsKanban({ goals, onUpdateStatus, onEdit, onEditWithGuidance, onDelete, onAdd, getAssignee, goalDependencies = [], timeLogTotals = new Map() }: GoalsKanbanProps) {
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = React.useState<GoalStatus | null>(null);
  const [showStale, setShowStale] = React.useState(false);

  // Filtering is now handled by the parent (GoalsTab) — goals passed in are already filtered
  const filteredGoals = goals;

  const handleDragStart = (e: React.DragEvent, goalId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('goalId', goalId);
    setDraggingId(goalId);
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDragOverCol(null);
  };

  const handleDragOver = (e: React.DragEvent, status: GoalStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCol(status);
  };

  const handleDrop = (e: React.DragEvent, status: GoalStatus) => {
    e.preventDefault();
    const goalId = e.dataTransfer.getData('goalId');
    if (goalId) onUpdateStatus(goalId, status);
    setDraggingId(null);
    setDragOverCol(null);
  };

  if (goals.length === 0) {
    return (
      <div className="border border-border bg-surface p-12 text-center">
        <Target size={32} className="text-border mx-auto mb-3" />
        <p className="text-sm text-muted mb-4">No tasks yet. Add your first task to start tracking progress.</p>
        <button type="button" onClick={onAdd}
          className="inline-flex items-center gap-2 px-4 py-2 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md">
          <Plus size={14} /> Add Task
        </button>
      </div>
    );
  }

  const renderCard = (goal: Goal, colStatus: GoalStatus, stale = false) => {
    const assigneeList = (goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : [])).map(getAssignee).filter(Boolean);
    const isDragging = draggingId === goal.id;
    const barCls = barColors[colStatus];
    const riskDot = riskDotColor(goal.risk_score);
    const myDeps = goalDependencies.filter((d) => d.goal_id === goal.id);
    const blockedDeps = myDeps.filter((d) => {
      const depGoal = goals.find((g) => g.id === d.depends_on_goal_id);
      return depGoal && depGoal.status !== 'complete';
    });
    const loggedHours = timeLogTotals.get(goal.id);
    return (
      <div
        key={goal.id}
        draggable
        onDragStart={(e) => handleDragStart(e, goal.id)}
        onDragEnd={handleDragEnd}
        className={`group border rounded p-3 cursor-grab active:cursor-grabbing select-none transition-all ${
          isDragging ? 'opacity-30' : 'hover:border-border/80 hover:shadow-sm'
        } ${stale ? 'bg-surface border-border/30 opacity-40 saturate-0' : 'bg-surface2 border-border'}`}
      >
        <div className="flex items-start justify-between gap-1 mb-1.5">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {riskDot && <span className={`w-2 h-2 rounded-full shrink-0 ${riskDot}`} title={`Risk score: ${Math.round((goal.risk_score ?? 0) * 100)}`} />}
            <div className="min-w-0">
              <p className="text-xs text-heading font-medium leading-snug">{goal.title}</p>
              {goal.loe && <p className="text-[9px] text-accent2 font-mono mt-0.5 truncate">{goal.loe}</p>}
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" title="Get AI guidance" onClick={(e) => { e.stopPropagation(); onEditWithGuidance(goal.id); }}
              className="p-0.5 text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
              <Sparkles size={11} />
            </button>
            <button type="button" title="Expand goal" onClick={() => onEdit(goal.id)}
              className="p-0.5 text-muted hover:text-accent transition-colors opacity-0 group-hover:opacity-100">
              <ExternalLink size={11} />
            </button>
            <button type="button" title="Delete goal" onClick={() => onDelete(goal.id)}
              className="p-0.5 text-muted hover:text-danger transition-colors">
              <Trash2 size={11} />
            </button>
          </div>
        </div>

        <div className="mb-2">
          <div className="h-1.5 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barCls}`}
              style={{ width: `${goal.progress ?? 0}%` }}
            />
          </div>
          <span className="text-[9px] text-muted font-mono">{goal.progress ?? 0}%</span>
        </div>

        <div className="flex items-center justify-between gap-1 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {goal.deadline && (
              <span className="text-[9px] text-muted font-mono">{new Date(goal.deadline).toLocaleDateString()}</span>
            )}
            {goal.category && (
              <span className="text-[9px] px-1.5 py-0.5 border border-border text-muted rounded font-mono">{goal.category}</span>
            )}
            {assigneeList.length > 0 && (
              <div className="flex items-center gap-0.5 flex-wrap">
                {assigneeList.slice(0, 2).map((a) => (
                  <span key={a!.user_id} className="text-[9px] text-muted truncate max-w-[70px]">{a!.display_name}</span>
                ))}
                {assigneeList.length > 2 && (
                  <span className="text-[9px] text-muted font-mono">+{assigneeList.length - 2}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {myDeps.length > 0 && (
              <span className={`text-[9px] font-mono flex items-center gap-0.5 ${blockedDeps.length > 0 ? 'text-red-400' : 'text-muted'}`}
                title={`${myDeps.length} dependenc${myDeps.length === 1 ? 'y' : 'ies'}${blockedDeps.length > 0 ? ` (${blockedDeps.length} blocking)` : ''}`}>
                <Link size={8} />{myDeps.length}
              </span>
            )}
            {loggedHours != null && loggedHours > 0 && (
              <span className="text-[9px] text-muted font-mono flex items-center gap-0.5" title="Hours logged">
                <Clock size={8} />{loggedHours.toFixed(1)}h
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[60vh]">
      {KANBAN_COLUMNS.map((col) => {
        const allColGoals = filteredGoals.filter((g) => g.status === col.status);
        const isComplete = col.status === 'complete';
        const freshGoals = isComplete ? allColGoals.filter((g) => !isStaleComplete(g)) : allColGoals;
        const staleGoals = isComplete ? allColGoals.filter((g) => isStaleComplete(g)) : [];
        const isOver = dragOverCol === col.status;

        return (
          <div
            key={col.status}
            className={`flex flex-col flex-1 min-w-0 border rounded transition-colors ${
              isOver ? `${col.accent} bg-surface2` : 'border-border bg-surface'
            }`}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            {/* Column header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wider ${col.color}`}>{col.label}</span>
                <span className="text-[10px] text-muted bg-surface2 px-1.5 py-0.5 rounded font-mono">
                  {freshGoals.length}{staleGoals.length > 0 ? `+${staleGoals.length}` : ''}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 flex-1 overflow-y-auto">
              {freshGoals.length === 0 && !isOver && (
                <p className="text-[10px] text-muted/50 text-center py-4">No tasks here</p>
              )}
              {freshGoals.map((goal) => renderCard(goal, col.status, false))}

              {/* Stale completed goals */}
              {isComplete && staleGoals.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowStale((v) => !v)}
                    className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-muted hover:text-heading border border-dashed border-border/50 rounded transition-colors mt-1"
                  >
                    <span className={`transition-transform ${showStale ? 'rotate-90' : ''}`}>▶</span>
                    {showStale ? 'Hide' : 'Show'} {staleGoals.length} archived goal{staleGoals.length !== 1 ? 's' : ''}
                  </button>
                  {showStale && staleGoals.map((goal) => renderCard(goal, col.status, true))}
                </>
              )}

              {/* Drop target hint when dragging */}
              {isOver && draggingId && (
                <div className={`border-2 border-dashed ${col.accent} rounded p-3 text-center text-[10px] text-muted`}>
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}

export interface GoalsTabProps {
  goals: Goal[];
  events: OdysseyEvent[];
  projectId: string | null;
  searchRef: React.RefObject<SearchPanelHandle>;
  projectCategories?: string[];
  projectLoes?: string[];
  /** Optional ref that will be set to a function that triggers the "From Notes" file picker */
  fromNotesTriggerRef?: React.RefObject<(() => void) | null>;
  riskAssessing: boolean;
  riskReport: {
    assessments: { goalId: string; score: number; level: string; factors: string[] }[];
    generatedAt: string;
  } | null;
  riskPanelOpen: boolean;
  setRiskPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  syncingProgress: boolean;
  syncResult: { summary: string; applied: number; provider?: string } | null;
  setSyncResult: React.Dispatch<React.SetStateAction<{ summary: string; applied: number; provider?: string } | null>>;
  syncError: string | null;
  goalDependencies: GoalDependency[];
  timeLogTotals: Map<string, number>;
  getAssignee: (userId: string | null | undefined) => { user_id?: string; display_name: string | null; avatar_url: string | null } | null;
  handleAssessRisk: () => void;
  handleSyncOfficeProgress: () => void;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<unknown>;
  deleteGoal: (id: string) => void;
  setEditGoal: (goal: Goal | null) => void;
  setEditAutoGuidance: (v: boolean) => void;
  setActiveTab: (tab: string) => void;
  goalModalOnOpen: () => void;
  createGoal: (data: { title: string; description?: string; category?: string; loe?: string; deadline?: string }) => Promise<unknown>;
}

function GoalsTab({
  goals,
  events,
  projectId,
  searchRef,
  projectCategories = [],
  projectLoes = [],
  fromNotesTriggerRef,
  riskAssessing,
  riskReport,
  riskPanelOpen,
  setRiskPanelOpen,
  syncingProgress,
  syncResult,
  setSyncResult,
  syncError,
  goalDependencies,
  timeLogTotals,
  getAssignee,
  handleAssessRisk,
  handleSyncOfficeProgress,
  updateGoal,
  deleteGoal,
  setEditGoal,
  setEditAutoGuidance,
  setActiveTab,
  goalModalOnOpen,
  createGoal,
}: GoalsTabProps) {
  const [filterCategories, setFilterCategories] = React.useState<string[]>([]);
  const [filterLoes, setFilterLoes] = React.useState<string[]>([]);
  const [filterAssignees, setFilterAssignees] = React.useState<string[]>([]);
  const [searchQuery, setSearchQuery] = React.useState('');

  // ── Meeting notes import ──────────────────────────────────────────────────
  const { agent } = useAIAgent();
  const notesInputRef = React.useRef<HTMLInputElement>(null);

  // Expose trigger to parent (e.g. Add Task modal "From Notes" button)
  React.useEffect(() => {
    if (fromNotesTriggerRef) {
      (fromNotesTriggerRef as React.MutableRefObject<(() => void) | null>).current = () => notesInputRef.current?.click();
    }
    return () => {
      if (fromNotesTriggerRef) {
        (fromNotesTriggerRef as React.MutableRefObject<(() => void) | null>).current = null;
      }
    };
  }, [fromNotesTriggerRef]);
  const [notesLoading, setNotesLoading] = React.useState(false);
  const [notesError, setNotesError] = React.useState<string | null>(null);
  interface SuggestedTask { title: string; description: string; category: string | null; loe: string | null; deadline: string | null; }
  const [suggestedTasks, setSuggestedTasks] = React.useState<SuggestedTask[]>([]);
  const [selectedTaskIdxs, setSelectedTaskIdxs] = React.useState<Set<number>>(new Set());
  const [notesModalOpen, setNotesModalOpen] = React.useState(false);
  const [addingTasks, setAddingTasks] = React.useState(false);

  const handleNotesFile = async (file: File | null | undefined) => {
    if (!file || !projectId) return;
    setNotesLoading(true);
    setNotesError(null);
    setSuggestedTasks([]);

    // Read file as text or base64 then send to server for extraction
    let fileContent = '';
    try {
      fileContent = await file.text();
    } catch {
      fileContent = '';
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;

      const res = await fetch('/api/ai/meeting-notes-tasks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          agent,
          projectId,
          fileContent: fileContent.slice(0, 50_000),
          fileName: file.name,
          existingTaskTitles: goals.map((g) => g.title),
        }),
      });
      const data = await res.json() as { tasks?: SuggestedTask[]; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? 'Failed to extract tasks');
      const tasks: SuggestedTask[] = (data.tasks ?? []).slice(0, 30);
      setSuggestedTasks(tasks);
      setSelectedTaskIdxs(new Set(tasks.map((_, i) => i)));
      setNotesModalOpen(true);
    } catch (err: unknown) {
      setNotesError(err instanceof Error ? err.message : 'Failed to extract tasks');
    } finally {
      setNotesLoading(false);
      if (notesInputRef.current) notesInputRef.current.value = '';
    }
  };

  const handleAddSelectedTasks = async () => {
    setAddingTasks(true);
    const toAdd = suggestedTasks.filter((_, i) => selectedTaskIdxs.has(i));
    for (const t of toAdd) {
      await createGoal({
        title: t.title,
        ...(t.description ? { description: t.description } : {}),
        ...(t.category ? { category: t.category } : {}),
        ...(t.loe ? { loe: t.loe } : {}),
        ...(t.deadline ? { deadline: t.deadline } : {}),
      });
    }
    setNotesModalOpen(false);
    setSuggestedTasks([]);
    setSelectedTaskIdxs(new Set());
    setAddingTasks(false);
  };

  const allAssigneeIds = [...new Set(goals.flatMap((g) => g.assignees?.length ? g.assignees : (g.assigned_to ? [g.assigned_to] : [])))];
  const isFiltered = filterCategories.length > 0 || filterLoes.length > 0 || filterAssignees.length > 0;

  const filteredGoals = goals.filter((g) => {
    if (filterCategories.length > 0 && !filterCategories.includes(g.category ?? '')) return false;
    if (filterLoes.length > 0 && !filterLoes.includes(g.loe ?? '')) return false;
    if (filterAssignees.length > 0) {
      const ids = g.assignees?.length ? g.assignees : (g.assigned_to ? [g.assigned_to] : []);
      if (!filterAssignees.some((a) => ids.includes(a))) return false;
    }
    if (searchQuery.length >= 2) {
      const q = searchQuery.toLowerCase();
      const matches =
        g.title.toLowerCase().includes(q) ||
        g.description?.toLowerCase().includes(q) ||
        g.category?.toLowerCase().includes(q) ||
        g.loe?.toLowerCase().includes(q);
      if (!matches) return false;
    }
    return true;
  });

  const levelStyle: Record<string, string> = {
    critical: 'text-[var(--color-danger)] border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5',
    high:     'text-orange-400 border-orange-400/30 bg-orange-400/5',
    medium:   'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
    low:      'text-[var(--color-accent3)] border-[var(--color-accent3)]/30 bg-[var(--color-accent3)]/5',
  };

  const progressMap: Record<GoalStatus, number> = {
    not_started: 0, in_progress: 40, in_review: 75, complete: 100,
  };

  return (
    <div>
      <div className="flex items-center mb-4 gap-2 min-w-0 overflow-x-auto">
        <h3 className="font-sans text-sm font-bold text-heading shrink-0">Tasks ({goals.length})</h3>
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-nowrap">
          <SearchPanel
            ref={searchRef}
            projectId={projectId ?? null}
            goals={goals}
            events={events}
            onGoalSelect={(id) => {
              const g = goals.find((g) => g.id === id);
              if (g) { setEditAutoGuidance(false); setEditGoal(g); }
            }}
            onEventSelect={() => setActiveTab('activity')}
            onQueryChange={setSearchQuery}
          />
          {(projectCategories.length > 0 || projectLoes.length > 0 || allAssigneeIds.length > 0) && (
            <FilterDropdown
              placeholder="Filters"
              sections={[
                ...(projectCategories.length > 0 ? [{
                  key: 'category',
                  label: 'Categories',
                  options: projectCategories.map((c) => ({ value: c, label: c })),
                  selected: filterCategories,
                }] : []),
                ...(projectLoes.length > 0 ? [{
                  key: 'loe',
                  label: 'LOEs',
                  options: projectLoes.map((l) => ({ value: l, label: l })),
                  selected: filterLoes,
                }] : []),
                ...(allAssigneeIds.length > 0 ? [{
                  key: 'assignee',
                  label: 'Assignees',
                  options: allAssigneeIds.map((id) => {
                    const a = getAssignee(id);
                    return { value: id, label: a?.display_name ?? id };
                  }),
                  selected: filterAssignees,
                }] : []),
              ]}
              onChange={(key, selected) => {
                if (key === 'category') setFilterCategories(selected);
                else if (key === 'loe') setFilterLoes(selected);
                else if (key === 'assignee') setFilterAssignees(selected);
              }}
            />
          )}
          <button
            type="button"
            onClick={goalModalOnOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md shrink-0"
          >
            <Plus size={12} /> Add Task
          </button>
          <div className="flex items-stretch shrink-0">
            <button
              type="button"
              onClick={handleAssessRisk}
              disabled={riskAssessing}
              title="Run AI risk assessment on all tasks"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 border text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors disabled:opacity-50 ${riskReport ? 'rounded-l-md border-r-0 border-border text-muted' : 'rounded-md border-border text-muted'}`}
            >
              {riskAssessing ? <Loader2 size={12} className="animate-spin" /> : <ShieldAlert size={12} />}
              {riskAssessing ? 'Assessing…' : 'Assess'}
            </button>
            {riskReport && (
              <button
                type="button"
                onClick={() => setRiskPanelOpen(v => !v)}
                title={riskPanelOpen ? 'Hide risk report' : 'Show risk report'}
                className={`inline-flex items-center gap-1 px-2 py-1.5 border border-border text-xs font-mono rounded-r-md transition-colors ${riskPanelOpen ? 'bg-surface2 text-heading' : 'text-muted hover:bg-surface2 hover:text-heading'}`}
              >
                {riskPanelOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
          </div>
        </div>
      </div>

      {syncResult && (
        <div className="mb-4 border border-accent/20 bg-accent/5 rounded p-4 text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold text-accent">
              {syncResult.applied > 0 ? `Updated ${syncResult.applied} task${syncResult.applied > 1 ? 's' : ''} from Office documents` : 'Analysis complete — no changes needed'}
            </span>
            <button type="button" title="Dismiss" onClick={() => setSyncResult(null)} className="text-muted hover:text-heading"><X size={12} /></button>
          </div>
          <p className="text-muted leading-relaxed">{syncResult.summary}</p>
          {syncResult.provider && <p className="text-[10px] text-muted/60 mt-1">via {syncResult.provider}</p>}
        </div>
      )}
      {/* Risk Assessment Panel */}
      {riskReport && riskPanelOpen && (() => {
        const sorted = [...riskReport.assessments].sort((a, b) => b.score - a.score);
        const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
        sorted.forEach(a => { if (counts[a.level] !== undefined) counts[a.level]++; });
        return (
          <div className="mb-4 border border-border rounded-lg overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-surface2 border-b border-border">
              <div className="flex items-center gap-2">
                <ShieldAlert size={12} className="text-muted" />
                <span className="text-xs font-semibold text-heading">Risk Assessment</span>
                <span className="text-[10px] text-muted font-mono">
                  {new Date(riskReport.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {(['critical','high','medium','low'] as const).map(lvl => counts[lvl] > 0 && (
                  <span key={lvl} className={`text-[9px] font-mono px-1.5 py-0.5 border rounded ${levelStyle[lvl]}`}>
                    {counts[lvl]} {lvl}
                  </span>
                ))}
                <button type="button" title="Close" onClick={() => setRiskPanelOpen(false)} className="text-muted hover:text-heading transition-colors ml-1">
                  <X size={12} />
                </button>
              </div>
            </div>
            {/* Goal rows */}
            <div className="divide-y divide-border/50 max-h-72 overflow-y-auto">
              {sorted.map(a => {
                const goal = goals.find(g => g.id === a.goalId);
                if (!goal) return null;
                return (
                  <div key={a.goalId} className="flex items-start gap-3 px-4 py-2.5 hover:bg-surface2/50 transition-colors">
                    <span className={`shrink-0 text-[9px] font-mono px-1.5 py-0.5 border rounded mt-0.5 ${levelStyle[a.level] ?? ''}`}>
                      {a.level}
                    </span>
                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        className="text-xs text-heading font-mono text-left hover:text-accent transition-colors truncate w-full"
                        onClick={() => { setEditAutoGuidance(false); setEditGoal(goal); }}
                      >
                        {goal.title}
                      </button>
                      {a.factors.length > 0 && (
                        <ul className="mt-0.5 space-y-0.5">
                          {a.factors.map((f, i) => (
                            <li key={i} className="text-[10px] text-muted font-mono flex items-start gap-1">
                              <span className="shrink-0 mt-0.5 opacity-50">·</span>{f}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <span className="text-[10px] font-mono text-muted shrink-0">{a.score}/100</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {syncError && (
        <div className="mb-4 border border-danger/20 bg-danger/5 rounded p-3 text-xs text-danger font-mono">{syncError}</div>
      )}

      {/* Meeting notes error banner */}
      {notesError && (
        <div className="mb-4 border border-danger/20 bg-danger/5 rounded p-3 text-xs text-danger font-mono flex items-center justify-between">
          {notesError}
          <button type="button" title="Dismiss" onClick={() => setNotesError(null)}><X size={12} /></button>
        </div>
      )}

      <GoalsKanban
        goals={filteredGoals}
        onUpdateStatus={(id, status) => {
          updateGoal(id, { status, progress: progressMap[status] });
        }}
        onEdit={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}
        onEditWithGuidance={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(true); setEditGoal(g); } }}
        onDelete={deleteGoal}
        onAdd={goalModalOnOpen}
        getAssignee={getAssignee}
        goalDependencies={goalDependencies}
        timeLogTotals={timeLogTotals}
      />

      {/* Hidden file input for meeting notes */}
      <input
        ref={notesInputRef}
        type="file"
        title="Upload meeting notes file"
        accept=".txt,.md,.pdf,.docx,.doc,.csv"
        className="hidden"
        onChange={(e) => { handleNotesFile(e.target.files?.[0]); e.target.value = ''; }}
      />

      {/* Suggested tasks modal */}
      {notesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface border border-border rounded-lg shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
              <div>
                <h2 className="text-sm font-bold text-heading font-sans">Suggested Tasks from Notes</h2>
                <p className="text-[10px] text-muted mt-0.5">Select which tasks to add to the project</p>
              </div>
              <button type="button" title="Close" onClick={() => setNotesModalOpen(false)} className="text-muted hover:text-heading transition-colors"><X size={14} /></button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {suggestedTasks.length === 0 && (
                <p className="text-xs text-muted text-center py-6">No tasks found in this document.</p>
              )}
              {suggestedTasks.map((t, i) => (
                <label key={i} className={`flex gap-3 items-start p-3 border rounded cursor-pointer transition-colors ${selectedTaskIdxs.has(i) ? 'border-accent/30 bg-accent/5' : 'border-border hover:border-border/70'}`}>
                  <input
                    type="checkbox"
                    checked={selectedTaskIdxs.has(i)}
                    onChange={(e) => {
                      setSelectedTaskIdxs((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(i); else next.delete(i);
                        return next;
                      });
                    }}
                    className="mt-0.5 accent-[var(--color-accent)] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono font-semibold text-heading leading-snug">{t.title}</p>
                    {t.description && <p className="text-[10px] text-muted mt-0.5 leading-relaxed">{t.description}</p>}
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {t.category && <span className="text-[9px] font-mono bg-surface2 border border-border text-muted px-1.5 py-0.5 rounded">{t.category}</span>}
                      {t.loe && <span className="text-[9px] font-mono bg-surface2 border border-border text-muted px-1.5 py-0.5 rounded">{t.loe}</span>}
                      {t.deadline && <span className="text-[9px] font-mono bg-surface2 border border-border text-muted px-1.5 py-0.5 rounded">{new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-3">
              <span className="text-[10px] text-muted font-mono">{selectedTaskIdxs.size} of {suggestedTasks.length} selected</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setNotesModalOpen(false)} className="px-4 py-1.5 border border-border text-muted text-xs font-semibold uppercase tracking-wider rounded hover:bg-surface2 transition-colors">Cancel</button>
                <button
                  type="button"
                  onClick={handleAddSelectedTasks}
                  disabled={selectedTaskIdxs.size === 0 || addingTasks}
                  className="px-4 py-1.5 border border-accent/30 bg-accent/10 text-accent text-xs font-semibold uppercase tracking-wider rounded hover:bg-accent/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {addingTasks ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                  {addingTasks ? 'Adding…' : `Add ${selectedTaskIdxs.size} Task${selectedTaskIdxs.size !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default React.memo(GoalsTab);
