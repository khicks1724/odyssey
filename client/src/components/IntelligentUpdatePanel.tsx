import { useState } from 'react';
import { X, Sparkles, Loader2, Check, Ban, Plus, Pencil, Trash2, CalendarClock, CalendarCheck, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';

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

const TYPE_META: Record<Suggestion['type'], { icon: React.ReactNode; label: string; color: string }> = {
  create_goal:      { icon: <Plus size={12} />,         label: 'Create Goal',       color: 'text-accent3 bg-accent3/10 border-accent3/30' },
  update_goal:      { icon: <Pencil size={12} />,       label: 'Update Goal',       color: 'text-accent2 bg-accent2/10 border-accent2/30' },
  delete_goal:      { icon: <Trash2 size={12} />,       label: 'Remove Goal',       color: 'text-danger  bg-danger/10  border-danger/30' },
  extend_deadline:  { icon: <CalendarClock size={12} />, label: 'Extend Deadline',  color: 'text-accent  bg-accent/10  border-accent/30' },
  contract_deadline:{ icon: <CalendarCheck size={12} />, label: 'Move Deadline Up', color: 'text-muted   bg-surface2   border-border' },
};

const PRIORITY_BADGE: Record<string, string> = {
  high:   'bg-danger/10  text-danger  border-danger/30',
  medium: 'bg-accent/10  text-accent  border-accent/30',
  low:    'bg-border/50  text-muted   border-border',
};

export default function IntelligentUpdatePanel({ projectId, onClose, onGoalMutated }: IntelligentUpdatePanelProps) {
  const { agent } = useAIAgent();
  const [loading,     setLoading]     = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [states,      setStates]      = useState<Record<string, 'idle' | 'accepted' | 'rejected' | 'executing'>>({});
  const [expanded,    setExpanded]    = useState<Record<string, boolean>>({});
  const [error,       setError]       = useState<string | null>(null);
  const [provider,    setProvider]    = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setStates({});
    try {
      const res = await fetch('/api/ai/intelligent-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent, projectId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Error ${res.status}`); return; }
      setSuggestions(data.suggestions ?? []);
      setProvider(data.provider ?? null);
      const initialStates: Record<string, 'idle'> = {};
      (data.suggestions ?? []).forEach((s: Suggestion) => { initialStates[s.id] = 'idle'; });
      setStates(initialStates);
    } catch {
      setError('Network error — is the server running?');
    } finally {
      setLoading(false);
    }
  };

  const executeSuggestion = async (s: Suggestion) => {
    setStates((prev) => ({ ...prev, [s.id]: 'executing' }));
    try {
      const { type, args } = s;

      if (type === 'create_goal') {
        await supabase.from('goals').insert({
          project_id: projectId,
          title:       args.title as string,
          deadline:    (args.deadline as string) || null,
          category:    (args.category as string) || null,
          assigned_to: (args.assignedTo as string) || null,
          status: 'not_started', progress: 0,
        });
      } else if (type === 'update_goal') {
        const updates = args.updates as Record<string, unknown>;
        await supabase.from('goals').update(updates).eq('id', args.goalId as string);
      } else if (type === 'delete_goal') {
        await supabase.from('goals').delete().eq('id', args.goalId as string);
      } else if (type === 'extend_deadline' || type === 'contract_deadline') {
        await supabase.from('goals').update({ deadline: args.suggestedDeadline }).eq('id', args.goalId as string);
      }

      setStates((prev) => ({ ...prev, [s.id]: 'accepted' }));
      onGoalMutated();
    } catch (err) {
      console.error('Failed to execute suggestion:', err);
      setStates((prev) => ({ ...prev, [s.id]: 'idle' }));
    }
  };

  const acceptAll = async () => {
    for (const s of suggestions) {
      if (states[s.id] === 'idle') await executeSuggestion(s);
    }
  };

  const pendingCount = suggestions.filter((s) => states[s.id] === 'idle').length;
  const acceptedCount = suggestions.filter((s) => states[s.id] === 'accepted').length;

  return (
      <div className="flex flex-col h-full overflow-hidden bg-surface">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-accent" />
            <div>
              <div className="text-sm font-bold text-heading font-sans">Intelligent Update</div>
              <div className="text-[10px] text-muted font-mono">AI-powered goal suggestions</div>
            </div>
          </div>
          <button type="button" onClick={onClose} title="Close" className="text-muted hover:text-heading transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {!loading && suggestions.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
              <Sparkles size={32} className="text-muted/30" />
              <div>
                <p className="text-sm text-heading font-sans mb-1">Analyze Your Project</p>
                <p className="text-xs text-muted leading-relaxed max-w-xs">
                  The AI will review your goals, documents, commits, and team activity to suggest improvements —
                  like goals to add, remove, or reschedule.
                </p>
              </div>
              <button
                type="button"
                onClick={runAnalysis}
                className="flex items-center gap-2 px-5 py-2.5 bg-accent text-white text-sm rounded hover:bg-accent/90 transition-colors font-medium"
              >
                <Sparkles size={14} /> Run Analysis
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-sm text-muted">Analyzing project across all sources…</p>
            </div>
          )}

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

          {suggestions.length > 0 && (
            <div className="p-4 space-y-3">
              {/* Stats bar */}
              <div className="flex items-center justify-between text-[10px] text-muted pb-2 border-b border-border">
                <span>{suggestions.length} suggestions · {acceptedCount} accepted · {pendingCount} pending</span>
                {provider && <span className="font-mono">{provider}</span>}
              </div>

              {suggestions.map((s) => {
                const meta    = TYPE_META[s.type] ?? TYPE_META.update_goal;
                const state   = states[s.id] ?? 'idle';
                const isOpen  = expanded[s.id] ?? false;

                return (
                  <div
                    key={s.id}
                    className={`border rounded-lg overflow-hidden transition-opacity ${
                      state === 'accepted' ? 'opacity-50' : state === 'rejected' ? 'opacity-30' : ''
                    }`}
                  >
                    {/* Card header */}
                    <div className="flex items-start gap-3 p-3">
                      {/* Type badge */}
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide border shrink-0 mt-0.5 ${meta.color}`}>
                        {meta.icon} {meta.label}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-heading leading-snug">{s.title}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono uppercase ${PRIORITY_BADGE[s.priority] ?? PRIORITY_BADGE.low}`}>
                              {s.priority}
                            </span>
                          </div>
                        </div>

                        {/* Toggle reasoning */}
                        <button
                          type="button"
                          onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                          className="flex items-center gap-1 mt-1 text-[10px] text-muted hover:text-heading transition-colors"
                        >
                          {isOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          {isOpen ? 'Hide reasoning' : 'Why?'}
                        </button>

                        {isOpen && (
                          <p className="mt-2 text-[11px] text-muted leading-relaxed border-t border-border/50 pt-2">
                            {s.reasoning}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {state === 'idle' && (
                      <div className="flex border-t border-border">
                        <button
                          type="button"
                          onClick={() => executeSuggestion(s)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-accent3 hover:bg-accent3/5 transition-colors border-r border-border font-medium"
                        >
                          <Check size={11} /> Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => setStates((prev) => ({ ...prev, [s.id]: 'rejected' }))}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[11px] text-muted hover:bg-surface2 transition-colors"
                        >
                          <Ban size={11} /> Dismiss
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
                        <Ban size={11} /> Dismissed
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
      </div>
  );
}
