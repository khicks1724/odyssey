import { useState, useRef, useEffect } from 'react';
import './IntelligentUpdatePanel.css';
import {
  X, Sparkles, Loader2, Check, Ban, Plus, Pencil, Trash2,
  CalendarClock, CalendarCheck, AlertTriangle, Edit3,
  Circle, CheckCircle, Loader, AlertCircle,
} from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';
import type { Goal } from '../types';
import GoalEditModal, { type MemberOption } from './GoalEditModal';
import { useAIErrorDialog } from '../lib/ai-error';

// ── Types ────────────────────────────────────────────────────────────────────

interface Suggestion {
  id: string;
  type: 'create_goal' | 'update_goal' | 'delete_goal' | 'extend_deadline' | 'contract_deadline';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reasoning: string;
  args: Record<string, unknown>;
}

interface IntelligentUpdatePanelProps {
  projectId: string;
  onClose: () => void;
  onGoalMutated: () => void;
}

// ── Config maps ───────────────────────────────────────────────────────────────

const TYPE_META: Record<Suggestion['type'], { icon: React.ReactNode; label: string; color: string }> = {
  create_goal:       { icon: <Plus size={11} />,          label: 'Create Task',       color: 'text-accent3 bg-accent3/10 border-accent3/30' },
  update_goal:       { icon: <Pencil size={11} />,        label: 'Update Task',       color: 'text-accent2 bg-accent2/10 border-accent2/30' },
  delete_goal:       { icon: <Trash2 size={11} />,        label: 'Remove Task',       color: 'text-danger  bg-danger/10  border-danger/30'  },
  extend_deadline:   { icon: <CalendarClock size={11} />, label: 'Extend Deadline',   color: 'text-accent  bg-accent/10  border-accent/30'  },
  contract_deadline: { icon: <CalendarCheck size={11} />, label: 'Move Deadline Up',  color: 'text-muted   bg-surface2   border-border'     },
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-danger/10  text-danger  border-danger/30',
  medium: 'bg-accent/10  text-accent  border-accent/30',
  low:    'bg-border/50  text-muted   border-border',
};

const STATUS_CFG = {
  not_started: { icon: Circle,        color: 'text-[#D94F4F]', bg: 'bg-[#D94F4F]/10', label: 'Not Started' },
  in_progress: { icon: Loader,        color: 'text-[#D97E2A]', bg: 'bg-[#D97E2A]/10', label: 'In Progress' },
  in_review:   { icon: AlertCircle,   color: 'text-[#facc15]', bg: 'bg-[#facc15]/10', label: 'In Review'   },
  complete:    { icon: CheckCircle,   color: 'text-[#6DBE7D]', bg: 'bg-[#6DBE7D]/10', label: 'Complete'    },
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a draft Goal object from a suggestion so we can preview and edit it */
function buildDraft(s: Suggestion, goals: Goal[]): Goal {
  const base: Goal = {
    id: `DRAFT_${s.id}`,
    project_id: '',
    title: '',
    deadline: null,
    status: 'not_started',
    risk_score: null,
    progress: 0,
    completed_at: null,
    assigned_to: null,
    assignees: [],
    category: null,
    loe: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: null,
  };

  if (s.type === 'create_goal') {
    return {
      ...base,
      title:       (s.args.title as string) ?? 'New Task',
      deadline:    (s.args.deadline as string) ?? null,
      category:    (s.args.category as string) ?? null,
      assigned_to: (s.args.assignedTo as string) ?? null,
    };
  }

  const existing = goals.find((g) => g.id === s.args.goalId);

  if (s.type === 'update_goal') {
    const updates = (s.args.updates as Record<string, unknown>) ?? {};
    return { ...(existing ?? base), ...updates, id: existing?.id ?? base.id };
  }

  if (s.type === 'delete_goal') {
    return existing ?? { ...base, title: (s.args.goalTitle as string) ?? 'Unknown Task', id: s.args.goalId as string };
  }

  // extend_deadline / contract_deadline
  return {
    ...(existing ?? base),
    id: existing?.id ?? base.id,
    deadline: (s.args.suggestedDeadline as string) ?? existing?.deadline ?? null,
  };
}

// ── Progress fill — width set imperatively to avoid inline-style linter warn ──

function ProgressFill({ pct }: { pct: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.style.width = `${pct}%`;
  }, [pct]);
  return <div ref={ref} className="iu-progress-fill" />;
}

// ── Inline task card (static preview) ────────────────────────────────────────

function TaskPreview({ draft, isDelete }: { draft: Goal; isDelete?: boolean }) {
  const cfg = STATUS_CFG[draft.status as keyof typeof STATUS_CFG] ?? STATUS_CFG.not_started;
  const Icon = cfg.icon;
  const daysLeft = draft.deadline
    ? Math.ceil((new Date(draft.deadline).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className={`border border-border rounded p-3 space-y-2 bg-surface2 ${isDelete ? 'opacity-60' : ''}`}>
      {/* Title + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={12} className={`${cfg.color} shrink-0`} />
          <span className="text-xs font-semibold text-heading leading-snug break-words">{draft.title || '—'}</span>
        </div>
        <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded font-mono uppercase tracking-wide border ${cfg.bg} ${cfg.color}`}>
          {cfg.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-border rounded-full overflow-hidden">
          <ProgressFill pct={draft.progress} />
        </div>
        <span className="text-[9px] text-muted font-mono w-7 text-right">{draft.progress}%</span>
      </div>

      {/* Tags row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {draft.category && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent2/10 text-accent2 uppercase tracking-wide">{draft.category}</span>
        )}
        {draft.loe && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent3/10 text-accent3 uppercase tracking-wide">{draft.loe}</span>
        )}
        {daysLeft !== null && (
          <span className={`ml-auto text-[9px] font-mono ${daysLeft < 0 ? 'text-danger' : daysLeft <= 7 ? 'text-accent' : 'text-muted'}`}>
            {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d left`}
          </span>
        )}
        {!draft.deadline && <span className="ml-auto text-[9px] text-muted font-mono">No deadline</span>}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IntelligentUpdatePanel({ projectId, onClose, onGoalMutated }: IntelligentUpdatePanelProps) {
  const { agent, providers } = useAIAgent();
  const { showAIError, aiErrorDialog } = useAIErrorDialog(agent, providers);
  const [loading,      setLoading]      = useState(false);
  const [suggestions,  setSuggestions]  = useState<Suggestion[]>([]);
  const [goals,        setGoals]        = useState<Goal[]>([]);
  const [members,      setMembers]      = useState<MemberOption[]>([]);
  const [states,       setStates]       = useState<Record<string, 'idle' | 'accepted' | 'rejected' | 'executing'>>({});
  const [error,        setError]        = useState<string | null>(null);
  const [provider,     setProvider]     = useState<string | null>(null);
  const [modifyTarget, setModifyTarget] = useState<{ suggestion: Suggestion; draft: Goal } | null>(null);

  // ── Fetch supporting data ─────────────────────────────────────────────────

  const fetchSupporting = async () => {
    const [{ data: goalsData }, { data: membersData }] = await Promise.all([
      supabase.from('goals').select('*').eq('project_id', projectId).order('created_at'),
      supabase.from('project_members')
        .select('user_id, profiles(display_name)')
        .eq('project_id', projectId),
    ]);
    setGoals((goalsData as Goal[]) ?? []);
    setMembers(
      ((membersData ?? []) as { user_id: string; profiles: { display_name: string | null } | null }[])
        .map((m) => ({ user_id: m.user_id, display_name: m.profiles?.display_name ?? null }))
    );
  };

  // ── Run analysis ──────────────────────────────────────────────────────────

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setStates({});
    await fetchSupporting();
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData.session?.access_token;
      const aiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) aiHeaders['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch('/api/ai/intelligent-update', {
        method: 'POST',
        headers: aiHeaders,
        body: JSON.stringify({ agent, projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
        showAIError(data.error ?? `Error ${res.status}`, res.status);
        return;
      }
      const list: Suggestion[] = data.suggestions ?? [];
      setSuggestions(list);
      setProvider(data.provider ?? null);
      const init: Record<string, 'idle'> = {};
      list.forEach((s) => { init[s.id] = 'idle'; });
      setStates(init);
    } catch {
      setError('Network error — is the server running?');
      showAIError('Network error — is the server running?', 502);
    } finally {
      setLoading(false);
    }
  };

  // ── Execute a suggestion (optionally with field overrides from modify) ─────

  const executeSuggestion = async (s: Suggestion, overrides?: Partial<Goal>) => {
    setStates((prev) => ({ ...prev, [s.id]: 'executing' }));
    try {
      const { type, args } = s;

      if (type === 'create_goal') {
        await supabase.from('goals').insert({
          project_id:  projectId,
          title:       overrides?.title       ?? (args.title as string),
          deadline:    overrides?.deadline    ?? (args.deadline as string) ?? null,
          category:    overrides?.category    ?? (args.category as string) ?? null,
          loe:         overrides?.loe         ?? null,
          assigned_to: overrides?.assigned_to ?? (args.assignedTo as string) ?? null,
          assignees:   overrides?.assignees   ?? [],
          status:      overrides?.status      ?? 'not_started',
          progress:    overrides?.progress    ?? 0,
        });
      } else if (type === 'update_goal') {
        const baseUpdates = args.updates as Record<string, unknown>;
        const merged = overrides ? { ...baseUpdates, ...overrides } : baseUpdates;
        await supabase.from('goals').update(merged).eq('id', args.goalId as string);
      } else if (type === 'delete_goal') {
        await supabase.from('goals').delete().eq('id', args.goalId as string);
      } else if (type === 'extend_deadline' || type === 'contract_deadline') {
        const newDeadline = overrides?.deadline ?? args.suggestedDeadline;
        await supabase.from('goals').update({ deadline: newDeadline }).eq('id', args.goalId as string);
      }

      setStates((prev) => ({ ...prev, [s.id]: 'accepted' }));
      onGoalMutated();
    } catch (err) {
      console.error('Failed to execute suggestion:', err);
      setStates((prev) => ({ ...prev, [s.id]: 'idle' }));
    }
  };

  // ── Modify: save from edit modal = accept with overrides ─────────────────

  const handleModifySave = async (id: string, updates: Partial<Goal>) => {
    if (!modifyTarget) return;
    const { suggestion } = modifyTarget;
    setModifyTarget(null);
    await executeSuggestion(suggestion, updates);
  };

  // ── Accept all ────────────────────────────────────────────────────────────

  const acceptAll = async () => {
    for (const s of suggestions) {
      if (states[s.id] === 'idle') await executeSuggestion(s);
    }
  };

  const pendingCount  = suggestions.filter((s) => states[s.id] === 'idle').length;
  const acceptedCount = suggestions.filter((s) => states[s.id] === 'accepted').length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-surface">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <div>
            <div className="text-sm font-bold text-heading font-sans">Intelligent Update</div>
            <div className="text-[10px] text-muted font-mono">AI-powered task suggestions</div>
          </div>
        </div>
        <button type="button" onClick={onClose} title="Close" className="text-muted hover:text-heading transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto min-h-0">

        {/* Empty state */}
        {!loading && suggestions.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
            <Sparkles size={32} className="text-muted/30" />
            <div>
              <p className="text-sm text-heading font-sans mb-1">Analyze Your Project</p>
              <p className="text-xs text-muted leading-relaxed max-w-xs">
                The AI will review your tasks, documents, commits, and team activity to suggest
                improvements — tasks to add, remove, or reschedule.
              </p>
            </div>
            <button
              type="button"
              onClick={runAnalysis}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent text-[var(--color-accent-fg)] text-sm rounded hover:bg-accent/90 transition-colors font-medium"
            >
              <Sparkles size={14} /> Run Analysis
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <Loader2 size={24} className="animate-spin text-accent" />
            <p className="text-sm text-muted">Analyzing project across all sources…</p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="m-5 p-4 border border-danger/30 bg-danger/5 rounded flex items-start gap-3">
            <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-heading mb-1">Analysis failed</p>
              <p className="text-xs text-muted">{error}</p>
              <button type="button" onClick={runAnalysis} className="text-xs text-accent hover:underline mt-2">Try again</button>
            </div>
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="p-4 space-y-3">
            {/* Stats bar */}
            <div className="flex items-center justify-between text-[10px] text-muted pb-2 border-b border-border">
              <span>{suggestions.length} suggestions · {acceptedCount} accepted · {pendingCount} pending</span>
              {provider && <span className="font-mono">{provider}</span>}
            </div>

            {suggestions.map((s) => {
              const meta  = TYPE_META[s.type] ?? TYPE_META.update_goal;
              const state = states[s.id] ?? 'idle';
              const draft = buildDraft(s, goals);
              const isDelete = s.type === 'delete_goal';

              return (
                <div
                  key={s.id}
                  className={`border border-border rounded-lg overflow-hidden transition-opacity ${
                    state === 'accepted' ? 'opacity-50' : state === 'rejected' ? 'opacity-30' : ''
                  }`}
                >
                  {/* Card header: type badge + priority */}
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide border shrink-0 ${meta.color}`}>
                      {meta.icon} {meta.label}
                    </div>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase ${PRIORITY_BADGE[s.priority] ?? PRIORITY_BADGE.low}`}>
                      {s.priority}
                    </span>
                  </div>

                  {/* Task preview card */}
                  <div className="px-3 pb-2">
                    <TaskPreview draft={draft} isDelete={isDelete} />
                  </div>

                  {/* Reasoning (always shown, collapsed-style) */}
                  <div className="px-3 pb-3">
                    <p className="text-[10px] text-muted leading-relaxed">{s.reasoning}</p>
                  </div>

                  {/* Action buttons */}
                  {state === 'idle' && (
                    <div className="flex border-t border-border">
                      {/* Accept */}
                      <button
                        type="button"
                        onClick={() => executeSuggestion(s)}
                        className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-accent3 hover:bg-accent3/5 transition-colors border-r border-border font-medium"
                      >
                        <Check size={11} /> Accept
                      </button>
                      {/* Modify (not shown for delete) */}
                      {!isDelete && (
                        <button
                          type="button"
                          onClick={() => setModifyTarget({ suggestion: s, draft })}
                          className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-accent2 hover:bg-accent2/5 transition-colors border-r border-border font-medium"
                        >
                          <Edit3 size={11} /> Modify
                        </button>
                      )}
                      {/* Reject */}
                      <button
                        type="button"
                        onClick={() => setStates((prev) => ({ ...prev, [s.id]: 'rejected' }))}
                        className="flex-1 flex items-center justify-center gap-1 py-2 text-[11px] text-muted hover:bg-surface2 transition-colors"
                      >
                        <Ban size={11} /> Reject
                      </button>
                    </div>
                  )}
                  {state === 'executing' && (
                    <div className="flex items-center justify-center gap-2 py-2 border-t border-border text-[11px] text-muted">
                      <Loader2 size={11} className="animate-spin" /> Applying…
                    </div>
                  )}
                  {state === 'accepted' && (
                    <div className="flex items-center justify-center gap-1.5 py-2 border-t border-border text-[11px] text-accent3">
                      <Check size={11} /> Applied
                    </div>
                  )}
                  {state === 'rejected' && (
                    <div className="flex items-center justify-center gap-1.5 py-2 border-t border-border text-[11px] text-muted">
                      <Ban size={11} /> Rejected
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {suggestions.length > 0 && (
        <div className="shrink-0 border-t border-border p-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={runAnalysis}
            disabled={loading}
            className="text-xs text-muted hover:text-heading transition-colors"
          >
            Re-run analysis
          </button>
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={acceptAll}
                className="flex items-center gap-1.5 px-4 py-1.5 bg-accent3 text-white text-xs rounded hover:bg-accent3/90 transition-colors font-medium"
              >
                <Check size={11} /> Accept All ({pendingCount})
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 border border-border text-muted text-xs rounded hover:text-heading hover:bg-surface2 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Modify modal — GoalEditModal with draft task data */}
      {modifyTarget && (
        <GoalEditModal
          goal={modifyTarget.draft}
          members={members}
          onSave={handleModifySave}
          onClose={() => setModifyTarget(null)}
        />
      )}
      {aiErrorDialog}
    </div>
  );
}
