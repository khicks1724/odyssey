import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Loader2, ChevronDown, Bot } from 'lucide-react';
import { useAIAgent } from '../lib/ai-agent';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  provider?: string;
}

interface Props {
  projectId: string;
  projectName: string;
}

export default function ProjectChat({ projectId, projectName }: Props) {
  const { agent } = useAIAgent();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent,
          projectId,
          messages: nextMessages,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Error ${res.status}`);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.message, provider: data.provider },
        ]);
      }
    } catch {
      setError('Network error — is the server running?');
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Project AI Chat"
        className={`fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all ${
          open
            ? 'bg-surface border border-border text-muted hover:text-heading'
            : 'bg-accent text-white hover:bg-accent/90'
        }`}
      >
        {open ? <ChevronDown size={18} /> : <MessageCircle size={18} />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-20 right-6 z-40 w-[380px] max-h-[520px] flex flex-col border border-border bg-surface shadow-xl rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface2 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bot size={14} className="text-accent" />
              <div>
                <div className="text-xs font-bold text-heading font-sans">Project AI</div>
                <div className="text-[10px] text-muted font-mono truncate max-w-[200px]">{projectName}</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted hover:text-heading transition-colors">
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
                  I can see your goals, activity, imported docs, and GitHub repo
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-3 py-2 rounded text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-accent text-white ml-4'
                      : 'bg-surface2 border border-border text-heading mr-4'
                  }`}
                >
                  {msg.content}
                  {msg.role === 'assistant' && msg.provider && (
                    <div className="text-[9px] text-muted mt-1 text-right opacity-60">{msg.provider}</div>
                  )}
                </div>
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
          <div className="flex-shrink-0 border-t border-border p-3 flex gap-2 items-end bg-surface">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about goals, docs, progress…"
              rows={1}
              className="flex-1 bg-surface2 border border-border text-heading text-xs font-mono placeholder:text-muted/50 px-3 py-2 focus:outline-none focus:border-accent/50 transition-colors resize-none rounded"
              style={{ minHeight: '36px', maxHeight: '90px', overflowY: 'auto' }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 90) + 'px';
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              className="p-2 bg-accent text-white rounded hover:bg-accent/90 transition-colors disabled:opacity-40 flex-shrink-0"
              title="Send (Enter)"
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
