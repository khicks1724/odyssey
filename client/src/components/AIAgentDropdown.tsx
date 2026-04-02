import { useState, useRef, useEffect } from 'react';
import { Zap, Bot, RefreshCw } from 'lucide-react';
import { useAIAgent, type AIAgentValue, type ProviderStatus, type KeySource } from '../lib/ai-agent';
import './AIAgentDropdown.css';

const agentMeta: Record<AIAgentValue, { name: string; shortName: string; description: string; colorClass: string; provider: string }> = {
  'auto':          { name: 'Auto',              shortName: 'Auto',    description: 'Picks the best available model for each task',    colorClass: 'aid-auto',    provider: '' },
  'claude-haiku':  { name: 'Claude Haiku',      shortName: 'Haiku',   description: 'Fastest · ideal for quick questions & summaries', colorClass: 'aid-haiku',   provider: 'Anthropic' },
  'claude-sonnet': { name: 'Claude Sonnet 4.6', shortName: 'Sonnet',  description: 'Balanced · great for analysis & chat',            colorClass: 'aid-sonnet',  provider: 'Anthropic' },
  'claude-opus':   { name: 'Claude Opus 4.6',   shortName: 'Opus',    description: 'Most capable · deep project insights',            colorClass: 'aid-opus',    provider: 'Anthropic' },
  'gpt-4o':        { name: 'GPT-4o',            shortName: 'GPT-4o',  description: 'OpenAI flagship model',                           colorClass: 'aid-gpt4o',   provider: 'OpenAI' },
  'gemini-pro':    { name: 'Gemini 2.5 Flash',  shortName: 'Gemini',  description: 'Google AI Studio · Gemini 2.5 Flash',             colorClass: 'aid-gemini',  provider: 'Google' },
  'genai-mil':     { name: 'GenAI.mil',         shortName: 'STARK',   description: 'DoD GenAI.mil · requires STARK API key + DoD network', colorClass: 'aid-genaimil', provider: 'DoD' },
};

const DISPLAY_ORDER: AIAgentValue[] = ['auto', 'claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro', 'genai-mil'];

// Group models by provider for section headers
const PROVIDER_GROUPS: { label: string; ids: AIAgentValue[] }[] = [
  { label: 'Auto',      ids: ['auto'] },
  { label: 'Anthropic', ids: ['claude-haiku', 'claude-sonnet', 'claude-opus'] },
  { label: 'OpenAI',    ids: ['gpt-4o'] },
  { label: 'Google',    ids: ['gemini-pro'] },
  { label: 'DoD / GenAI.mil', ids: ['genai-mil'] },
];

function StatusBadge({ available, active, serverReachable, status, keySource }: {
  available: boolean;
  active: boolean;
  serverReachable: boolean;
  status?: ProviderStatus;
  keySource?: KeySource;
}) {
  if (active) return (
    <span className="aid-badge aid-badge--active">
      <span className="aid-badge-dot aid-badge-dot--pulse" />
      Active
    </span>
  );
  if (!serverReachable) return <span className="aid-badge aid-badge--offline">Offline</span>;
  if (status === 'no_credits') return <span className="aid-badge aid-badge--nocredits">No Credits</span>;
  if (status === 'invalid_key') return <span className="aid-badge aid-badge--nokey">Bad Key</span>;
  if (status === 'error') return <span className="aid-badge aid-badge--offline">Error</span>;
  if (available) {
    const src = keySource === 'user' ? 'Your Key' : keySource === 'server' ? 'Server Key' : null;
    return (
      <span className="aid-badge aid-badge--ready">
        {src ?? 'Ready'}
      </span>
    );
  }
  return <span className="aid-badge aid-badge--nokey">Not Linked</span>;
}

export default function AIAgentDropdown() {
  const { agent, setAgent, providers, loading, serverReachable, lastUsed, refreshProviders } = useAIAgent();
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
  const buttonColorClass = agent === 'auto' ? (lastUsedMeta?.colorClass ?? 'aid-auto') : buttonMeta.colorClass;

  const getProvider = (id: AIAgentValue) => providers.find((p) => p.id === id);

  const isAvailable = (id: AIAgentValue) => {
    if (id === 'auto') return true;
    if (!serverReachable) return false;
    const p = getProvider(id);
    if (!p?.available) return false;
    // Gray out if credits gone or key invalid
    if (p.status === 'no_credits' || p.status === 'invalid_key') return false;
    return true;
  };

  const readyCount = providers.filter((p) => p.available).length;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title="Select AI model"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                   bg-[var(--color-surface)] border border-[var(--color-border)]
                   text-[var(--color-text)] hover:bg-[var(--color-surface2)] transition-colors cursor-pointer
                   ${open ? 'border-[var(--color-accent)]/40 bg-[var(--color-surface2)]' : ''}`}
      >
        <Bot size={13} className="text-[var(--color-muted)] shrink-0" />

        <span className={`relative flex items-center justify-center w-3.5 h-3.5 ${buttonColorClass}`}>
          {agent === 'auto'
            ? <Zap size={11} className="aid-icon" />
            : <span className="aid-dot aid-dot--active" />
          }
        </span>

        <span className="font-medium text-xs">
          {agent === 'auto'
            ? lastUsedMeta ? `Auto · ${lastUsedMeta.shortName}` : 'Auto'
            : buttonMeta.shortName}
        </span>

        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="text-[var(--color-muted)]">
          <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-[340px] rounded-lg border border-[var(--color-border)]
                        bg-[var(--color-surface)] shadow-xl z-50 overflow-hidden">

          {/* Header */}
          <div className="px-3 py-2.5 border-b border-[var(--color-border)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot size={12} className="text-[var(--color-muted)]" />
              <span className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] font-semibold">AI Model</span>
              {!loading && serverReachable && (
                <span className="text-[9px] font-mono text-[var(--color-muted)]/60">
                  {readyCount}/{providers.length} linked
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); refreshProviders?.(); }}
              title="Refresh model status"
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors p-0.5 rounded"
            >
              <RefreshCw size={10} />
            </button>
          </div>

          {!serverReachable && (
            <div className="px-3 py-2 bg-[var(--color-danger,#ef4444)]/10 border-b border-[var(--color-border)]">
              <p className="text-[10px] text-[var(--color-danger,#ef4444)]">
                ⚠ Server offline — start the API server to enable AI features.
              </p>
            </div>
          )}

          {loading ? (
            <div className="px-3 py-6 text-center text-xs text-[var(--color-muted)]">Checking model status…</div>
          ) : (
            <div className="py-1">
              {PROVIDER_GROUPS.map(({ label, ids }) => {
                const groupIds = ids.filter((id) => DISPLAY_ORDER.includes(id));
                return (
                  <div key={label}>
                    {label !== 'Auto' && (
                      <div className="px-3 pt-2 pb-1">
                        <span className="text-[9px] tracking-[0.12em] uppercase text-[var(--color-muted)]/50 font-semibold">{label}</span>
                      </div>
                    )}
                    {groupIds.map((id) => {
                      const meta = agentMeta[id];
                      const available = isAvailable(id);
                      const isActive = id === agent;
                      const pInfo = id !== 'auto' ? getProvider(id) : undefined;
                      const dimmed = !available && id !== 'auto';

                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => { if (available) { setAgent(id); setOpen(false); } }}
                          disabled={dimmed}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm text-left transition-colors
                            ${isActive ? 'bg-[var(--color-surface2)]'
                              : available ? 'hover:bg-[var(--color-surface2)] cursor-pointer'
                              : 'cursor-not-allowed'}`}
                        >
                          <span className={`flex items-center justify-center w-5 h-5 shrink-0 ${meta.colorClass} ${dimmed ? 'opacity-30' : ''}`}>
                            {id === 'auto'
                              ? <Zap size={13} className="aid-icon" />
                              : <span className={`aid-dot ${isActive ? 'aid-dot--active' : ''}`} />
                            }
                          </span>

                          <div className={`flex-1 min-w-0 ${dimmed ? 'opacity-40' : ''}`}>
                            <div className={`text-xs font-medium ${isActive ? 'text-[var(--color-heading)]' : 'text-[var(--color-text)]'}`}>
                              {meta.name}
                            </div>
                            <div className="text-[10px] text-[var(--color-muted)] truncate">{meta.description}</div>
                          </div>

                          <StatusBadge
                            available={available}
                            active={isActive}
                            serverReachable={serverReachable}
                            status={pInfo?.status}
                            keySource={pInfo?.keySource}
                          />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-between">
            <p className="text-[10px] text-[var(--color-muted)]">
              Add API keys in <strong>Settings → AI Models</strong>
            </p>
            {!loading && !serverReachable && (
              <span className="text-[9px] font-mono text-[var(--color-danger,#ef4444)] uppercase tracking-wider">Offline</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
