import React from 'react';
import {
  Sparkles,
  Plus,
  Loader2,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  X,
} from 'lucide-react';
import SearchPanel, { type SearchPanelHandle } from '../SearchPanel';
import type { Goal, OdysseyEvent, GoalDependency } from '../../types';

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
  onLogTime?: (goalId: string) => void;
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

function GoalsKanban({ goals, onUpdateStatus, onEdit, onEditWithGuidance, onDelete, onAdd, getAssignee, goalDependencies = [], timeLogTotals = new Map(), onLogTime }: GoalsKanbanProps) {
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
            {onLogTime && (
              <button type="button" title="Log time" onClick={(e) => { e.stopPropagation(); onLogTime(goal.id); }}
                className="p-0.5 text-muted hover:text-accent2 transition-colors opacity-0 group-hover:opacity-100">
                <Clock size={11} />
              </button>
            )}
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
  setLogTimeGoal: (goal: Goal | null) => void;
}

function GoalsTab({
  goals,
  events,
  projectId,
  searchRef,
  projectCategories = [],
  projectLoes = [],
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
  setLogTimeGoal,
}: GoalsTabProps) {
  const [filterCategory, setFilterCategory] = React.useState('');
  const [filterLoe, setFilterLoe] = React.useState('');
  const [filterAssignee, setFilterAssignee] = React.useState('');

  const allAssigneeIds = [...new Set(goals.flatMap((g) => g.assignees?.length ? g.assignees : (g.assigned_to ? [g.assigned_to] : [])))];
  const isFiltered = !!(filterCategory || filterLoe || filterAssignee);

  const filteredGoals = goals.filter((g) => {
    if (filterCategory && g.category !== filterCategory) return false;
    if (filterLoe && g.loe !== filterLoe) return false;
    if (filterAssignee) {
      const ids = g.assignees?.length ? g.assignees : (g.assigned_to ? [g.assigned_to] : []);
      if (!ids.includes(filterAssignee)) return false;
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

  const selectCls = (active: boolean) =>
    `text-[10px] font-mono px-2 py-1.5 rounded border bg-surface2 transition-colors outline-none cursor-pointer h-[30px] ${active ? 'border-accent text-heading' : 'border-border text-muted'}`;

  return (
    <div>
      <div className="flex items-center mb-4 gap-2 min-w-0">
        <h3 className="font-sans text-sm font-bold text-heading shrink-0">Tasks ({goals.length})</h3>
        <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
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
          />
          {projectCategories.length > 0 && (
            <select aria-label="Filter by category" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={selectCls(!!filterCategory)}>
              <option value="">All Categories</option>
              {projectCategories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {projectLoes.length > 0 && (
            <select aria-label="Filter by LOE" value={filterLoe} onChange={(e) => setFilterLoe(e.target.value)} className={`${selectCls(!!filterLoe)} min-w-[11rem]`}>
              <option value="">All Lines of Effort</option>
              {projectLoes.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          {allAssigneeIds.length > 0 && (
            <select aria-label="Filter by assignee" value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className={selectCls(!!filterAssignee)}>
              <option value="">All Assignees</option>
              {allAssigneeIds.map((id) => {
                const a = getAssignee(id);
                return <option key={id} value={id}>{a?.display_name ?? id}</option>;
              })}
            </select>
          )}
          {isFiltered && (
            <button type="button" onClick={() => { setFilterCategory(''); setFilterLoe(''); setFilterAssignee(''); }}
              className="text-[10px] font-mono text-muted hover:text-danger transition-colors px-2 py-1.5 border border-border rounded h-[30px]">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={goalModalOnOpen}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/5 transition-colors rounded-md shrink-0"
          >
            <Plus size={12} /> Add Task
          </button>
          <div className="flex items-center shrink-0">
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
          <button
            type="button"
            onClick={handleSyncOfficeProgress}
            disabled={syncingProgress}
            title="Analyze imported Office documents and auto-update goal progress using AI"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md disabled:opacity-50 shrink-0"
          >
            {syncingProgress ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Sync
          </button>
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
        onLogTime={(id) => { const g = goals.find((g) => g.id === id); if (g) setLogTimeGoal(g); }}
      />

    </div>
  );
}

export default React.memo(GoalsTab);
