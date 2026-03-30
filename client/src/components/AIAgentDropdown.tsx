import { useState, useRef, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { useAIAgent, type AIAgentValue } from '../lib/ai-agent';
import './AIAgentDropdown.css';

const agentMeta: Record<AIAgentValue, { name: string; shortName: string; description: string; colorClass: string }> = {
  'auto':          { name: 'Auto',              shortName: 'Auto',   description: 'Picks the fastest model for each task automatically', colorClass: 'aid-auto'   },
  'claude-haiku':  { name: 'Claude Haiku',      shortName: 'Haiku',  description: 'Fastest · ideal for quick questions & summaries',     colorClass: 'aid-haiku'  },
  'claude-sonnet': { name: 'Claude Sonnet 4.6', shortName: 'Sonnet', description: 'Balanced · great for analysis & chat',                colorClass: 'aid-sonnet' },
  'claude-opus':   { name: 'Claude Opus 4.6',   shortName: 'Opus',   description: 'Most capable · used for deep project insights',       colorClass: 'aid-opus'   },
  'gpt-4o':        { name: 'GPT-4o',            shortName: 'GPT-4o', description: 'OpenAI flagship model',                               colorClass: 'aid-gpt4o'  },
  'gemini-pro':    { name: 'Gemini 2.5 Flash',    shortName: 'Gemini', description: 'Google AI · Gemini 2.5 Flash (preview)',            colorClass: 'aid-gemini' },
};

const DISPLAY_ORDER: AIAgentValue[] = ['auto', 'claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro'];

export default function AIAgentDropdown() {
  const { agent, setAgent, providers, loading, serverReachable, lastUsed } = useAIAgent();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const buttonMeta = agentMeta[agent];
  const lastUsedMeta = lastUsed ? agentMeta[lastUsed] : null;
  // Button dot uses last-used color when in Auto mode
  const buttonColorClass = agent === 'auto' ? (lastUsedMeta?.colorClass ?? 'aid-auto') : buttonMeta.colorClass;

  // When server is unreachable, treat all as unavailable but show different reason
  const isAvailable = (id: AIAgentValue) =>
    id === 'auto' || (serverReachable && (providers.find((p) => p.id === id)?.available ?? false));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                   bg-[var(--color-surface)] border border-[var(--color-border)]
                   text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors cursor-pointer"
      >
        <span className={`relative flex items-center justify-center w-4 h-4 ${buttonColorClass}`}>
          {agent === 'auto'
            ? <Zap size={12} className="aid-icon" />
            : <span className="aid-dot aid-dot--active" />
          }
        </span>

        <span className="font-medium">
          {agent === 'auto'
            ? lastUsedMeta ? `Auto · ${lastUsedMeta.shortName}` : 'Auto'
            : buttonMeta.name}
        </span>

        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-[var(--color-muted)]">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-96 rounded-lg border border-[var(--color-border)]
                        bg-[var(--color-surface)] shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] font-semibold">AI Model</span>
            {agent === 'auto' && lastUsedMeta && (
              <span className="text-[10px] text-[var(--color-muted)]">
                last: <span className={`aid-last-used ${lastUsedMeta.colorClass}`}>{lastUsedMeta.shortName}</span>
              </span>
            )}
          </div>

          {!serverReachable && (
            <div className="px-3 py-2 bg-[var(--color-danger,#ef4444)]/10 border-b border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-danger,#ef4444)]">
                ⚠ Server offline — start the server to enable AI models.
              </p>
            </div>
          )}
          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">Loading…</div>
          ) : (
            <div className="py-1">
              {DISPLAY_ORDER.map((id) => {
                const meta = agentMeta[id];
                const available = isAvailable(id);
                const isActive = id === agent;

                return (
                  <button
                    key={id}
                    onClick={() => { if (available) { setAgent(id); setOpen(false); } }}
                    disabled={!available}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors
                      ${isActive ? 'bg-[var(--color-surface2)]'
                        : available ? 'hover:bg-[var(--color-surface2)] cursor-pointer'
                        : 'opacity-40 cursor-not-allowed'}`}
                  >
                    <span className={`flex items-center justify-center w-5 h-5 shrink-0 ${meta.colorClass}`}>
                      {id === 'auto'
                        ? <Zap size={14} className="aid-icon" />
                        : <span className={`aid-dot ${isActive ? 'aid-dot--active' : ''}`} />
                      }
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${isActive ? 'text-[var(--color-heading)]' : 'text-[var(--color-text)]'}`}>
                        {meta.name}
                      </div>
                      <div className="text-[10px] text-[var(--color-muted)]">{meta.description}</div>
                    </div>

                    {isActive ? (
                      <span className="flex items-center gap-1 text-[10px] tracking-[0.08em] uppercase font-medium text-green-500 shrink-0">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Active
                      </span>
                    ) : available ? (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-muted)] shrink-0">Ready</span>
                    ) : !serverReachable ? (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-muted)] shrink-0">Offline</span>
                    ) : (
                      <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--color-muted)] shrink-0">No Key</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2 border-t border-[var(--color-border)]">
            <p className="text-[10px] text-[var(--color-muted)] leading-relaxed">
              <strong>Auto</strong> routes Haiku → fast tasks · Sonnet → analysis · Opus → deep insights
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
