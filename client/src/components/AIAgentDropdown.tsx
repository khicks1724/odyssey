import { useState, useRef, useEffect } from 'react';
import { useAIAgent, type AIProvider } from '../lib/ai-agent';

const agentMeta: Record<AIProvider, { name: string; provider: string; color: string }> = {
  'claude-sonnet': { name: 'Claude Sonnet', provider: 'Anthropic', color: '#d97706' },
  'gpt-4o': { name: 'GPT-4o', provider: 'OpenAI', color: '#10b981' },
  'gemini-pro': { name: 'Gemini Pro', provider: 'Google', color: '#6366f1' },
};

export default function AIAgentDropdown() {
  const { agent, setAgent, providers, loading } = useAIAgent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const activeMeta = agentMeta[agent];
  const activeProvider = providers.find((p) => p.id === agent);
  const connectedCount = providers.filter((p) => p.available).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                   bg-[var(--color-surface)] border border-[var(--color-border)]
                   text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors cursor-pointer"
      >
        <span className="relative flex items-center justify-center w-4 h-4">
          <span
            className="w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: activeMeta?.color ?? 'var(--color-muted)' }}
          />
          {activeProvider?.available && (
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-500" />
          )}
        </span>
        <span className="font-medium">{activeMeta?.name ?? agent}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--color-muted)]">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-[var(--color-border)]
                     bg-[var(--color-surface)] shadow-xl z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] font-semibold">
              Select AI Model
            </span>
            <span className="text-[10px] text-[var(--color-muted)]">
              {connectedCount}/{providers.length} connected
            </span>
          </div>

          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
              Loading providers…
            </div>
          ) : providers.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">
              No AI providers configured
            </div>
          ) : (
            <div className="py-1">
              {providers.map((p) => {
                const meta = agentMeta[p.id];
                const isActive = p.id === agent;
                return (
                  <button
                    key={p.id}
                    onClick={() => { if (p.available) { setAgent(p.id); setOpen(false); } }}
                    disabled={!p.available}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors
                      ${isActive
                        ? 'bg-[var(--color-surface2)]'
                        : p.available
                          ? 'hover:bg-[var(--color-surface2)] cursor-pointer'
                          : 'opacity-40 cursor-not-allowed'
                      }`}
                  >
                    {/* Color dot */}
                    <span className="flex items-center justify-center w-5 h-5 shrink-0">
                      <span
                        className="w-3 h-3 rounded-full border-2"
                        style={{
                          backgroundColor: isActive ? meta?.color : 'transparent',
                          borderColor: meta?.color ?? 'var(--color-muted)',
                        }}
                      />
                    </span>

                    {/* Name & provider */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${isActive ? 'text-[var(--color-heading)]' : ''}`}>
                        {meta?.name ?? p.id}
                      </div>
                      <div className="text-[10px] text-[var(--color-muted)]">{meta?.provider}</div>
                    </div>

                    {/* Status badge */}
                    {isActive ? (
                      <span className="flex items-center gap-1 text-[10px] tracking-[0.08em] uppercase font-medium text-green-500">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        In Use
                      </span>
                    ) : p.available ? (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-accent)]">
                        Ready
                      </span>
                    ) : (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-muted)]">
                        No Key
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
