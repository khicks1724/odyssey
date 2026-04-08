import { useState, useEffect } from 'react';
import { X, Save, Loader2, Sparkles, RefreshCw, Link, ShieldAlert } from 'lucide-react';
import type { Goal } from '../types';
import { useGoalDependencies } from '../hooks/useGoalDependencies';
import type { FileRef } from '../hooks/useProjectFilePaths';
import MarkdownWithFileLinks from './MarkdownWithFileLinks';
import { supabase } from '../lib/supabase';

const API_BASE = '/api';

// Legacy fallbacks — overridden by per-project labels when provided
const CATEGORIES: string[] = [];
const LINES_OF_EFFORT: string[] = [];
const STATUSES: { value: Goal['status']; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review',   label: 'In Review' },
  { value: 'complete',    label: 'Complete' },
];
const CREATE_NEW_CATEGORY_VALUE = '__create_new_category__';
const CREATE_NEW_LOE_VALUE = '__create_new_loe__';

function getRiskLabel(score: number | null): { label: string; color: string } | null {
  if (score === null || score === undefined) return null;
  if (score >= 0.75) return { label: 'Critical Risk', color: 'text-[var(--color-danger)] border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5' };
  if (score >= 0.5)  return { label: 'High Risk',     color: 'text-orange-400 border-orange-400/40 bg-orange-400/5' };
  if (score >= 0.25) return { label: 'Medium Risk',   color: 'text-yellow-400 border-yellow-400/40 bg-yellow-400/5' };
  return               { label: 'Low Risk',      color: 'text-[var(--color-accent3)] border-[var(--color-accent3)]/40 bg-[var(--color-accent3)]/5' };
}

export interface MemberOption { user_id: string; display_name: string | null; }

interface GoalEditModalProps {
  goal: Goal;
  members: MemberOption[];
  projectId?: string;
  agent?: string;
  autoGuidance?: boolean;
  allGoals?: Goal[];
  filePaths?: Map<string, FileRef>;
  githubRepo?: string | string[] | null;
  gitlabRepos?: string[];
  projectCategories?: string[];
  projectLoes?: string[];
  onFileClick?: (ref: FileRef) => void;
  onRepoClick?: (repo: string, type: 'github' | 'gitlab') => void;
  onTaskClick?: (taskId: string) => void;
  onCreateProjectLabel?: (type: 'category' | 'loe', name: string) => Promise<string>;
  onSave: (id: string, updates: Partial<Pick<Goal, 'title' | 'description' | 'category' | 'loe' | 'assigned_to' | 'assignees' | 'deadline' | 'status' | 'progress' | 'ai_guidance'>>) => Promise<void>;
  /** Silent background save — does NOT close the modal. Used for auto-persisting AI guidance. */
  onSilentSave?: (id: string, updates: Partial<Pick<Goal, 'ai_guidance'>>) => Promise<void>;
  onClose: () => void;
}

export default function GoalEditModal({
  goal,
  members,
  projectId,
  agent,
  autoGuidance,
  allGoals = [],
  filePaths = new Map(),
  githubRepo = null,
  gitlabRepos = [],
  projectCategories = CATEGORIES,
  projectLoes = LINES_OF_EFFORT,
  onFileClick,
  onRepoClick,
  onTaskClick,
  onCreateProjectLabel,
  onSave,
  onSilentSave,
  onClose,
}: GoalEditModalProps) {
  const [title,          setTitle]          = useState(goal.title);
  const [notes,          setNotes]          = useState(goal.description ?? '');
  const [category,       setCategory]       = useState(goal.category ?? '');
  const [newCategory,    setNewCategory]    = useState('');
  const [loe,            setLoe]            = useState(goal.loe ?? '');
  const [newLoe,         setNewLoe]         = useState('');
  const [assignees,      setAssignees]      = useState<string[]>(goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []));
  const [deadline,       setDeadline]       = useState(goal.deadline?.split('T')[0] ?? '');
  const [status,         setStatus]         = useState<Goal['status']>(goal.status);
  const [progress,       setProgress]       = useState(goal.progress);
  const [saving,         setSaving]         = useState(false);
  const [saveError,      setSaveError]      = useState<string | null>(null);

  // Initialize from saved guidance on the task; keeps text even while regenerating
  const [guidance,        setGuidance]        = useState<string | null>(goal.ai_guidance ?? null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);

  // Dependency management
  const { dependencies, addDependency, removeDependency } = useGoalDependencies(goal.id, projectId);
  const dependencySet = new Set(dependencies.map(d => d.depends_on_goal_id));
  const otherGoals = allGoals.filter(g => g.id !== goal.id);

  const riskLabel = getRiskLabel(goal.risk_score);

  const fetchGuidance = async () => {
    if (!projectId) return;
    setGuidanceLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_BASE}/ai/task-guidance`, {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({
          agent: agent ?? 'auto',
          projectId,
          taskTitle: title || goal.title,
          taskStatus: status,
          taskProgress: progress,
          taskCategory: category || null,
          taskLoe: loe || null,
        }),
      });
      const data = await res.json();
      const text = res.ok ? (data.guidance ?? null) : null;
      setGuidance(text);
      // Auto-save guidance to the task so it persists for next open.
      // Use onSilentSave so the modal stays open (onSave closes the modal).
      if (text) {
        (onSilentSave ?? onSave)(goal.id, { ai_guidance: text }).catch(() => {});
      }
    } catch {
      // keep existing guidance on error
    }
    setGuidanceLoading(false);
  };

  useEffect(() => {
    if (autoGuidance && projectId) fetchGuidance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaveError(null);
    setSaving(true);
    try {
      if ((category === CREATE_NEW_CATEGORY_VALUE || loe === CREATE_NEW_LOE_VALUE) && !onCreateProjectLabel) {
        throw new Error('Project labels are unavailable right now.');
      }
      const resolvedCategory = category === CREATE_NEW_CATEGORY_VALUE
        ? await onCreateProjectLabel?.('category', newCategory)
        : category;
      const resolvedLoe = loe === CREATE_NEW_LOE_VALUE
        ? await onCreateProjectLabel?.('loe', newLoe)
        : loe;
      await onSave(goal.id, {
        title: title.trim(),
        description: notes.trim() || null,
        category: resolvedCategory || null,
        loe: resolvedLoe || null,
        assignees,
        deadline: deadline || null,
        status,
        progress,
      });
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save task.');
    } finally {
      setSaving(false);
    }
  };

  // Right panel is always shown when projectId is provided
  const showRightPanel = !!projectId;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className={`w-full bg-[var(--color-surface)] border border-[var(--color-border)] shadow-2xl rounded-lg overflow-hidden flex flex-col transition-all duration-300 max-h-[90vh] ${showRightPanel ? 'max-w-4xl' : 'max-w-md'}`} onClick={(e) => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] shrink-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[var(--color-heading)] font-sans">Edit Task</h3>
              {riskLabel && (
                <span className={`flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 border rounded ${riskLabel.color}`}>
                  <ShieldAlert size={8} />
                  {riskLabel.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {projectId && (
                <button
                  type="button"
                  title={guidance ? 'Regenerate AI guidance' : 'Get AI guidance'}
                  onClick={fetchGuidance}
                  disabled={guidanceLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] border border-[var(--color-accent)]/30 text-[var(--color-accent)] rounded hover:bg-[var(--color-accent)]/5 transition-colors disabled:opacity-40"
                >
                  {guidanceLoading
                    ? <Loader2 size={10} className="animate-spin" />
                    : guidance
                      ? <RefreshCw size={10} />
                      : <Sparkles size={10} />
                  }
                  {guidanceLoading ? 'Analyzing…' : guidance ? 'Regenerate' : 'AI Guidance'}
                </button>
              )}
              <button type="button" title="Close" onClick={onClose} className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body — two columns when projectId present */}
          <div className="flex flex-1 overflow-hidden">
            {/* Form column */}
            <div className={`p-5 space-y-4 overflow-y-auto ${showRightPanel ? 'w-[420px] shrink-0 border-r border-[var(--color-border)]' : 'w-full'}`}>
              {saveError && (
                <div className="rounded-md border border-[var(--color-danger)]/35 bg-[var(--color-danger)]/10 px-3 py-2 text-xs text-[var(--color-danger)]">
                  {saveError}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">Title</label>
                <textarea
                  title="Task title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-sm font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded resize-none"
                  autoFocus
                />
              </div>

              {/* Status + Progress */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Goal['status'])}
                    title="Status"
                    className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">
                    Progress — <span className="text-[var(--color-accent)] font-mono">{progress}%</span>
                  </label>
                  <input
                    type="range" min="0" max="100" step="5"
                    value={progress}
                    onChange={(e) => setProgress(Number(e.target.value))}
                    title="Progress"
                    className="w-full accent-[var(--color-accent)] mt-2"
                  />
                </div>
              </div>

              {/* Category + LOE */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">Category</label>
                  <select
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      if (e.target.value !== CREATE_NEW_CATEGORY_VALUE) setNewCategory('');
                    }}
                    title="Category"
                    className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                  >
                    <option value="">— None —</option>
                    <option value={CREATE_NEW_CATEGORY_VALUE}>+ Add New Category</option>
                    {projectCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {category === CREATE_NEW_CATEGORY_VALUE && (
                    <input
                      type="text"
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      placeholder="Enter new category"
                      className="mt-2 w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">Line of Effort</label>
                  <select
                    value={loe}
                    onChange={(e) => {
                      setLoe(e.target.value);
                      if (e.target.value !== CREATE_NEW_LOE_VALUE) setNewLoe('');
                    }}
                    title="Line of Effort"
                    className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                  >
                    <option value="">— None —</option>
                    <option value={CREATE_NEW_LOE_VALUE}>+ Add New LOE</option>
                    {projectLoes.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                  {loe === CREATE_NEW_LOE_VALUE && (
                    <input
                      type="text"
                      value={newLoe}
                      onChange={(e) => setNewLoe(e.target.value)}
                      placeholder="Enter new LOE"
                      className="mt-2 w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                    />
                  )}
                </div>
              </div>
              {/* Assigned To (multi-select) */}
              {members.length > 0 && (
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">
                    Assigned To <span className="text-[var(--color-muted)]/60 normal-case tracking-normal">(select multiple)</span>
                  </label>
                  <div className="border border-[var(--color-border)] rounded divide-y divide-[var(--color-border)]/50 max-h-36 overflow-y-auto">
                    {members.map((m) => {
                      const checked = assignees.includes(m.user_id);
                      return (
                        <label key={m.user_id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[var(--color-surface2)] transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAssignees((prev) =>
                              checked ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                            )}
                            className="w-3 h-3 shrink-0"
                          />
                          <span className="text-xs font-mono text-[var(--color-heading)] truncate">{m.display_name ?? m.user_id}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deadline */}
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1.5">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  title="Deadline"
                  className="w-full px-3 py-2 bg-[var(--color-surface2)] border border-[var(--color-border)] text-[var(--color-heading)] text-xs font-mono focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors rounded"
                />
                <div className="flex gap-2 mt-2">
                  {([
                    { label: '1W', days: 7 },
                    { label: '2W', days: 14 },
                    { label: '1M', months: 1 },
                    { label: '2M', months: 2 },
                  ] as { label: string; days?: number; months?: number }[]).map(({ label, days, months }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        const d = new Date();
                        if (days) d.setDate(d.getDate() + days);
                        if (months) d.setMonth(d.getMonth() + months);
                        setDeadline(d.toISOString().split('T')[0]);
                      }}
                      className="flex-1 px-2 py-1 text-[10px] font-mono border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-colors rounded"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* AI Guidance panel — always shown when projectId present */}
            {showRightPanel && (
              <div className="flex-1 flex flex-col overflow-hidden bg-[var(--color-surface2)]/30">
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--color-border)]">
                    <div className="px-4 py-3 border-b border-[var(--color-border)] shrink-0">
                      <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] font-semibold">Notes</span>
                    </div>
                    <div className="min-h-0 flex-1 p-4">
                      <textarea
                        title="Task notes"
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Capture details, dependencies, handoff context, or any other notes for this task."
                        className="h-full min-h-[180px] w-full resize-none rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm text-[var(--color-heading)] focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)] shrink-0">
                      <Sparkles size={12} className="text-[var(--color-accent)]" />
                      <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-accent)] font-semibold">AI Guidance</span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                      {guidanceLoading ? (
                        <div className="flex items-center gap-2 text-[var(--color-muted)]">
                          <Loader2 size={13} className="animate-spin text-[var(--color-accent)]" />
                          <span className="text-xs animate-pulse">Analyzing task against the repository…</span>
                        </div>
                      ) : guidance ? (
                        <div className="text-[12px] text-[var(--color-muted)] leading-relaxed">
                          <MarkdownWithFileLinks
                            block
                            filePaths={filePaths}
                            onFileClick={onFileClick ?? (() => {})}
                            githubRepo={githubRepo}
                            gitlabRepos={gitlabRepos}
                            onRepoClick={onRepoClick}
                            tasks={allGoals.map((g) => ({ id: g.id, title: g.title }))}
                            onTaskClick={onTaskClick}
                          >
                            {guidance}
                          </MarkdownWithFileLinks>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-6 py-8">
                          <Sparkles size={28} className="text-[var(--color-accent)]/30" />
                          <p className="text-xs font-semibold text-[var(--color-muted)]/60">No AI Guidance Yet</p>
                          <p className="text-[11px] text-[var(--color-muted)]/50 leading-relaxed">
                            Click the <span className="text-[var(--color-accent)] font-semibold">AI Guidance</span> button above to get tailored suggestions for this task, including next steps and likely risks.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface2)] shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-heading)] border border-[var(--color-border)] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-accent)] text-white text-xs rounded hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
