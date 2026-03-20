import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Save, Loader2, Sparkles, RefreshCw } from 'lucide-react';
import type { Goal } from '../types';

const API_BASE = '/api';

const CATEGORIES = ['Testing', 'Seeker', 'Missile', 'Admin', 'Simulation', 'DevOps'];
const LINES_OF_EFFORT = ['Training', 'Simulation', 'JetsonCV', 'Image Capture', 'Flight Software', 'IR Camera Suite', 'Admin'];
const STATUSES: { value: Goal['status']; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review',   label: 'In Review' },
  { value: 'complete',    label: 'Complete' },
];

export interface MemberOption { user_id: string; display_name: string | null; }

interface GoalEditModalProps {
  goal: Goal;
  members: MemberOption[];
  projectId?: string;
  agent?: string;
  autoGuidance?: boolean;
  onSave: (id: string, updates: Partial<Pick<Goal, 'title' | 'category' | 'loe' | 'assigned_to' | 'assignees' | 'deadline' | 'status' | 'progress'>>) => Promise<void>;
  onClose: () => void;
}

export default function GoalEditModal({ goal, members, projectId, agent, autoGuidance, onSave, onClose }: GoalEditModalProps) {
  const [title,      setTitle]      = useState(goal.title);
  const [category,   setCategory]   = useState(goal.category ?? '');
  const [loe,        setLoe]        = useState(goal.loe ?? '');
  const [assignees,  setAssignees]  = useState<string[]>(goal.assignees?.length ? goal.assignees : (goal.assigned_to ? [goal.assigned_to] : []));
  const [deadline,   setDeadline]   = useState(goal.deadline?.split('T')[0] ?? '');
  const [status,     setStatus]     = useState<Goal['status']>(goal.status);
  const [progress,   setProgress]   = useState(goal.progress);
  const [saving,     setSaving]     = useState(false);

  const [guidance,        setGuidance]        = useState<string | null>(null);
  const [guidanceLoading, setGuidanceLoading] = useState(false);

  const fetchGuidance = async () => {
    if (!projectId) return;
    setGuidanceLoading(true);
    try {
      const res = await fetch(`${API_BASE}/ai/task-guidance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      setGuidance(res.ok ? (data.guidance ?? null) : null);
    } catch {
      setGuidance(null);
    }
    setGuidanceLoading(false);
  };

  // Auto-start guidance if triggered from card sparkle button
  useEffect(() => {
    if (autoGuidance && projectId) fetchGuidance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(goal.id, {
      title:       title.trim(),
      category:    category || null,
      loe:         loe      || null,
      assignees,
      deadline:    deadline || null,
      status,
      progress,
    });
    setSaving(false);
    onClose();
  };

  const hasGuidance = guidanceLoading || !!guidance;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className={`w-full bg-surface border border-border shadow-2xl rounded-lg overflow-hidden flex flex-col transition-all duration-300 max-h-[90vh] ${hasGuidance ? 'max-w-4xl' : 'max-w-md'}`}>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
            <h3 className="text-sm font-bold text-heading font-sans">Edit Task</h3>
            <div className="flex items-center gap-2">
              {projectId && (
                <button
                  type="button"
                  title={guidance ? 'Regenerate AI guidance' : 'Get AI guidance'}
                  onClick={fetchGuidance}
                  disabled={guidanceLoading}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] border border-accent/30 text-accent rounded hover:bg-accent/5 transition-colors disabled:opacity-40"
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
              <button type="button" title="Close" onClick={onClose} className="text-muted hover:text-heading transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body — two columns when guidance is present */}
          <div className="flex flex-1 overflow-hidden">
            {/* Form column */}
            <div className={`p-5 space-y-4 overflow-y-auto ${hasGuidance ? 'w-[420px] shrink-0 border-r border-border' : 'w-full'}`}>
              {/* Title */}
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Title</label>
                <input
                  type="text"
                  title="Task title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-sm font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
                  autoFocus
                />
              </div>

              {/* Status + Progress */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Goal['status'])}
                    title="Status"
                    className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
                  >
                    {STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">
                    Progress — <span className="text-accent font-mono">{progress}%</span>
                  </label>
                  <input
                    type="range" min="0" max="100" step="5"
                    value={progress}
                    onChange={(e) => setProgress(Number(e.target.value))}
                    title="Progress"
                    className="w-full accent-accent mt-2"
                  />
                </div>
              </div>

              {/* Category + LOE */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    title="Category"
                    className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
                  >
                    <option value="">— None —</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Line of Effort</label>
                  <select
                    value={loe}
                    onChange={(e) => setLoe(e.target.value)}
                    title="Line of Effort"
                    className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
                  >
                    <option value="">— None —</option>
                    {LINES_OF_EFFORT.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              </div>

              {/* Assigned To (multi-select) */}
              {members.length > 0 && (
                <div>
                  <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">
                    Assigned To <span className="text-muted/60 normal-case tracking-normal">(select multiple)</span>
                  </label>
                  <div className="border border-border rounded divide-y divide-border/50 max-h-36 overflow-y-auto">
                    {members.map((m) => {
                      const checked = assignees.includes(m.user_id);
                      return (
                        <label key={m.user_id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-surface2 transition-colors">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAssignees((prev) =>
                              checked ? prev.filter((id) => id !== m.user_id) : [...prev, m.user_id]
                            )}
                            className="accent-accent w-3 h-3 shrink-0"
                          />
                          <span className="text-xs font-mono text-heading truncate">{m.display_name ?? m.user_id}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deadline */}
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-1.5">Deadline</label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  title="Deadline"
                  className="w-full px-3 py-2 bg-surface2 border border-border text-heading text-xs font-mono focus:outline-none focus:border-accent/50 transition-colors rounded"
                />
              </div>
            </div>

            {/* AI Guidance panel — only shown when loading or has content */}
            {hasGuidance && (
              <div className="flex-1 flex flex-col overflow-hidden bg-surface2/30">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                  <Sparkles size={12} className="text-accent" />
                  <span className="text-[10px] tracking-[0.15em] uppercase text-accent font-semibold">AI Guidance</span>
                </div>
                <div className="flex-1 overflow-y-auto px-4 py-4">
                  {guidanceLoading ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Loader2 size={13} className="animate-spin text-accent" />
                      <span className="text-xs animate-pulse">Analyzing task against the repository…</span>
                    </div>
                  ) : (
                    <div className="text-[12px] text-muted leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          h1: ({ children }) => <h1 className="text-sm font-bold mb-2 mt-3 first:mt-0 text-heading">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-xs font-bold mb-1.5 mt-2.5 first:mt-0 text-heading">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-xs font-semibold mb-1 mt-2 first:mt-0 text-heading">{children}</h3>,
                          ul: ({ children }) => <ul className="mb-2 pl-4 space-y-1 list-disc">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 pl-4 space-y-1 list-decimal">{children}</ol>,
                          strong: ({ children }) => <strong className="font-semibold text-heading">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          code: ({ children }) => <code className="bg-surface border border-border rounded px-1 py-0.5 font-mono text-[10px]">{children}</code>,
                          a: ({ href, children }) => <a href={href} className="text-accent2 underline" target="_blank" rel="noreferrer">{children}</a>,
                        }}
                      >
                        {guidance ?? ''}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border bg-surface2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-xs text-muted hover:text-heading border border-border rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white text-xs rounded hover:bg-accent/90 transition-colors disabled:opacity-40"
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
