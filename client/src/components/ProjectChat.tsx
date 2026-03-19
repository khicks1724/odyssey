import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Loader2, ChevronDown, Bot, Check, Ban, Plus, Pencil, Trash2, GripVertical } from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';
import { supabase } from '../lib/supabase';
import './ProjectChat.css';

interface PendingAction {
  type: 'create_goal' | 'update_goal' | 'delete_goal';
  description: string;
  args: Record<string, unknown>;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
  pendingAction?: PendingAction;
  actionState?: 'pending' | 'approved' | 'denied';
}

interface Props {
  projectId: string;
  projectName: string;
  onGoalMutated?: () => void;
}

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_goal: <Plus size={12} />,
  update_goal: <Pencil size={12} />,
  delete_goal: <Trash2 size={12} />,
};

const ACTION_COLORS: Record<string, string> = {
  create_goal: 'border-accent3/30 bg-accent3/5 text-accent3',
  update_goal: 'border-accent2/30 bg-accent2/5 text-accent2',
  delete_goal: 'border-danger/30  bg-danger/5  text-danger',
};

const MIN_W = 320;
const MAX_W = 800;
const MIN_H = 300;
const MAX_H = 900;
const DEFAULT_W = 400;
const DEFAULT_H = 560;

export default function ProjectChat({ projectId, projectName, onGoalMutated }: Props) {
  const { agent } = useAIAgent();
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [size,     setSize]     = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const [pos,      setPos]      = useState<{ x: number; y: number } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // ── Move drag (header) ────────────────────────────────────────────────────
  const moveRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const onMoveMove = useCallback((e: MouseEvent) => {
    if (!moveRef.current) return;
    const dx = e.clientX - moveRef.current.startX;
    const dy = e.clientY - moveRef.current.startY;
    setPos({ x: moveRef.current.startPosX + dx, y: moveRef.current.startPosY + dy });
  }, []);

  const onMoveUp = useCallback(() => {
    moveRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMoveMove);
    window.removeEventListener('mouseup', onMoveUp);
  }, [onMoveMove]);

  const onMoveDown = useCallback((e: React.MouseEvent) => {
    if (!pos) return;
    e.preventDefault();
    moveRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    window.addEventListener('mousemove', onMoveMove);
    window.addEventListener('mouseup', onMoveUp);
  }, [pos, onMoveMove, onMoveUp]);

  // ── Resize drag (bottom-right corner) ─────────────────────────────────────
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const onResizeMove = useCallback((e: MouseEvent) => {
    if (!resizeRef.current) return;
    const { startX, startY, startW, startH } = resizeRef.current;
    setSize({
      w: Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX))),
      h: Math.min(MAX_H, Math.max(MIN_H, startH + (e.clientY - startY))),
    });
  }, []);

  const onResizeUp = useCallback(() => {
    resizeRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeUp);
  }, [onResizeMove]);

  const onResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: size.w, startH: size.h };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeUp);
  }, [size, onResizeMove, onResizeUp]);

  // Initialise position when first opened — just above the trigger button (bottom-right)
  useEffect(() => {
    if (open && pos === null) {
      const x = Math.max(16, window.innerWidth - DEFAULT_W - 16);
      const y = Math.max(16, window.innerHeight - DEFAULT_H - 80);
      setPos({ x, y });
    }
  }, [open, pos]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMoveMove);
    window.removeEventListener('mouseup', onMoveUp);
    window.removeEventListener('mousemove', onResizeMove);
    window.removeEventListener('mouseup', onResizeUp);
  }, [onMoveMove, onMoveUp, onResizeMove, onResizeUp]);

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    if (!overrideText) setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          projectId,
          messages: next.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.message,
            provider: data.provider,
            pendingAction: data.pendingAction ?? undefined,
            actionState: data.pendingAction ? 'pending' : undefined,
          },
        ]);
      }
    } catch {
      setError('Network error — is the server running?');
    }
    setLoading(false);
  };

  const executeAction = async (action: PendingAction): Promise<string> => {
    const { type, args } = action;

    if (type === 'create_goal') {
      const { data, error: err } = await supabase.from('goals').insert({
        project_id:  projectId,
        title:       args.title as string,
        deadline:    (args.deadline as string) || null,
        category:    (args.category as string) || null,
        assigned_to: (args.assignedTo as string) || null,
        status:      'not_started',
        progress:    0,
      }).select().single();
      if (err) throw err;
      return `Created goal: "${data.title}"`;
    }

    if (type === 'update_goal') {
      const updates = args.updates as Record<string, unknown>;
      const { data, error: err } = await supabase.from('goals')
        .update(updates).eq('id', args.goalId as string).select().single();
      if (err) throw err;
      return `Updated goal: "${data.title}"`;
    }

    if (type === 'delete_goal') {
      const { error: err } = await supabase.from('goals').delete().eq('id', args.goalId as string);
      if (err) throw err;
      return `Deleted goal: "${args.goalTitle}"`;
    }

    throw new Error(`Unknown action type: ${type}`);
  };

  const handleApprove = async (msgIdx: number, action: PendingAction) => {
    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'approved' } : m));
    try {
      const result = await executeAction(action);
      onGoalMutated?.();
      sendMessage(`Action completed: ${result}`);
    } catch (err) {
      console.error('Action failed:', err);
      setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'pending' } : m));
      setError(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const handleDeny = (msgIdx: number, action: PendingAction) => {
    setMessages((prev) => prev.map((m, i) => i === msgIdx ? { ...m, actionState: 'denied' } : m));
    sendMessage(`User declined: "${action.description}". Please suggest an alternative.`);
  };

  return (
    <>
      {/* Toggle button — fixed bottom-right */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Project AI Chat"
        className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all ${
          open
            ? 'bg-surface border border-border text-muted hover:text-heading'
            : 'bg-accent text-white hover:bg-accent/90'
        }`}
      >
        {open ? <ChevronDown size={18} /> : <MessageCircle size={18} />}
      </button>

      {/* Floating chat window — position: fixed, no layout impact */}
      {open && pos && (
        <div
          className="pc-window"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          {...({ style: { '--pc-x': `${pos.x}px`, '--pc-y': `${pos.y}px`, '--pc-w': `${size.w}px`, '--pc-h': `${size.h}px` } } as any)}
        >
          {/* Header — drag handle */}
          <div
            className="pc-header"
            onMouseDown={onMoveDown}
          >
            <div className="flex items-center gap-2 min-w-0">
              <GripVertical size={13} className="text-muted/50 shrink-0" />
              <Bot size={14} className="text-accent shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-heading font-sans">Project AI</div>
                <div className="text-[10px] text-muted font-mono truncate max-w-[200px]">{projectName}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              onMouseDown={(e) => e.stopPropagation()}
              title="Close chat"
              className="text-muted hover:text-heading transition-colors shrink-0 ml-2"
            >
              <X size={14} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Bot size={24} className="text-muted mx-auto mb-2" />
                <p className="text-xs text-muted font-mono">
                  Ask me anything about <span className="text-accent">{projectName}</span>
                </p>
                <p className="text-[10px] text-muted/60 mt-1">
                  I can create, edit, and delete goals — I'll always ask before acting.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[88%] px-3 py-2 rounded text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-accent text-white ml-4'
                      : 'bg-surface2 border border-border text-heading mr-4'
                  }`}>
                    {msg.content}
                    {msg.role === 'assistant' && msg.provider && (
                      <div className="text-[9px] text-muted mt-1 text-right opacity-60">{msg.provider}</div>
                    )}
                  </div>
                </div>

                {msg.pendingAction && msg.actionState && (
                  <div className="mr-4 mt-2">
                    <div className={`border rounded p-3 ${ACTION_COLORS[msg.pendingAction.type] ?? 'border-border bg-surface2'}`}>
                      <div className="flex items-center gap-1.5 mb-1.5 font-medium text-[10px] uppercase tracking-wider">
                        {ACTION_ICONS[msg.pendingAction.type]}
                        Proposed Action
                      </div>
                      <p className="text-xs text-heading leading-snug mb-2">{msg.pendingAction.description}</p>

                      {msg.actionState === 'pending' && (
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => handleApprove(i, msg.pendingAction!)}
                            className="flex items-center gap-1 px-3 py-1 text-[10px] bg-accent3 text-white rounded hover:bg-accent3/90 transition-colors font-medium">
                            <Check size={10} /> Approve
                          </button>
                          <button type="button" onClick={() => handleDeny(i, msg.pendingAction!)}
                            className="flex items-center gap-1 px-3 py-1 text-[10px] border border-border text-muted rounded hover:text-heading hover:bg-surface2 transition-colors">
                            <Ban size={10} /> Decline
                          </button>
                        </div>
                      )}
                      {msg.actionState === 'approved' && (
                        <div className="flex items-center gap-1 text-[10px] text-accent3">
                          <Check size={10} /> Approved &amp; executed
                        </div>
                      )}
                      {msg.actionState === 'denied' && (
                        <div className="flex items-center gap-1 text-[10px] text-muted">
                          <Ban size={10} /> Declined
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-surface2 border border-border px-3 py-2 rounded flex items-center gap-2 mr-4">
                  <Loader2 size={11} className="animate-spin text-accent" />
                  <span className="text-[10px] text-muted font-mono">Thinking…</span>
                </div>
              </div>
            )}

            {error && (
              <div className="text-[10px] text-danger bg-danger/5 border border-danger/20 rounded px-3 py-2 font-mono">
                {error}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border p-3 flex gap-2 items-end bg-surface">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask or instruct the AI…"
              rows={1}
              className="pc-input flex-1 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-2 focus:outline-none focus:border-accent/50 transition-colors rounded"
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 90) + 'px';
              }}
            />
            <button type="button" onClick={() => sendMessage()} disabled={!input.trim() || loading}
              className="p-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-40 shrink-0"
              title="Send (Enter)">
              <Send size={13} />
            </button>
          </div>

          {/* Resize handle — bottom-right corner */}
          <div className="pc-resize-handle" onMouseDown={onResizeDown} title="Drag to resize" />
        </div>
      )}
    </>
  );
}
