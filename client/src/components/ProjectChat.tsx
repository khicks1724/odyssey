import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, Bot, Check, Ban, Plus, Pencil, Trash2, Copy, CheckCheck } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAIAgent } from '../lib/ai-agent';
import { useChatPanel, type ChatMessage as Message } from '../lib/chat-panel';
import { supabase } from '../lib/supabase';
import './ProjectChat.css';

type PendingAction = NonNullable<Message['pendingAction']>;

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

export default function ProjectChat({ projectId, projectName, onGoalMutated }: Props) {
  const { agent, notifyModelUsed } = useAIAgent();
  const { messages, setMessages } = useChatPanel();
  const [input,      setInput]      = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [copiedIdx,  setCopiedIdx]  = useState<number | null>(null);

  const copyMessage = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    });
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const sendMessage = useCallback(async (overrideText?: string) => {
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
        if (data.provider) notifyModelUsed(data.provider);
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
  }, [input, loading, messages, agent, projectId, notifyModelUsed]);

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
    <div className="pc-panel">
      {/* Header */}
      <div className="pc-panel-header">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={14} className="text-accent shrink-0" />
          <div className="min-w-0">
            <div className="text-xs font-bold text-heading font-sans">Project AI</div>
            <div className="text-[10px] text-muted font-mono truncate">{projectName}</div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="pc-messages flex-1 p-4 space-y-3">
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
              {msg.role === 'assistant' ? (
                <div className="relative group mr-2 max-w-[92%]">
                  {/* Copy button — top-right, appears on hover */}
                  <button
                    type="button"
                    onClick={() => copyMessage(msg.content, i)}
                    title="Copy response"
                    className="absolute -top-2 -right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity
                               w-6 h-6 flex items-center justify-center rounded
                               bg-surface border border-border text-muted hover:text-heading hover:bg-surface2"
                  >
                    {copiedIdx === i
                      ? <CheckCheck size={11} className="text-accent3" />
                      : <Copy size={11} />
                    }
                  </button>

                  <div className="pc-bubble px-3 py-2 rounded text-xs leading-relaxed bg-surface2 border border-border text-heading pc-md">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        h1: ({ children }) => <h1 className="text-sm font-bold mb-2 mt-3 first:mt-0 text-heading">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xs font-bold mb-1.5 mt-2.5 first:mt-0 text-heading">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-xs font-semibold mb-1 mt-2 first:mt-0 text-heading">{children}</h3>,
                        ul: ({ children }) => <ul className="mb-2 pl-4 space-y-0.5 list-disc leading-relaxed">{children}</ul>,
                        ol: ({ children }) => <ol className="mb-2 pl-4 space-y-0.5 list-decimal leading-relaxed">{children}</ol>,
                        strong: ({ children }) => <strong className="font-semibold text-heading">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        code: ({ children, className }) => {
                          const isBlock = className?.includes('language-');
                          return isBlock
                            ? <code className="block bg-surface border border-border rounded px-2 py-1.5 font-mono text-[10px] whitespace-pre overflow-x-auto mb-2 max-w-full">{children}</code>
                            : <code className="bg-surface border border-border rounded px-1 py-0.5 font-mono text-[10px] break-all">{children}</code>;
                        },
                        pre: ({ children }) => <pre className="mb-2 overflow-x-auto max-w-full">{children}</pre>,
                        blockquote: ({ children }) => <blockquote className="border-l-2 border-accent/40 pl-3 text-muted italic mb-2">{children}</blockquote>,
                        hr: () => <hr className="border-border my-2" />,
                        a: ({ href, children }) => <a href={href} className="text-accent2 underline" target="_blank" rel="noreferrer">{children}</a>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {msg.provider && (
                      <div className="text-[9px] text-muted mt-1 text-right opacity-60">{msg.provider}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="pc-bubble px-3 py-2 rounded text-xs leading-relaxed bg-accent text-white ml-2 whitespace-pre-wrap">
                  {msg.content}
                </div>
              )}
            </div>

            {msg.pendingAction && msg.actionState && (
              <div className="mr-2 mt-2">
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
            <div className="bg-surface2 border border-border px-3 py-2 rounded flex items-center gap-2 mr-2">
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
    </div>
  );
}
