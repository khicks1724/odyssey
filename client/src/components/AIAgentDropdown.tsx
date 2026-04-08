import { useState, useRef, useEffect } from 'react';
import { Zap, Bot, RefreshCw } from 'lucide-react';
import { isOpenAIAgentValue, useAIAgent, type AIAgentValue, type FixedAIProvider, type KeySource, type ProviderInfo, type ProviderStatus } from '../lib/ai-agent';
import { canonicalizeOpenAiModelId } from '../lib/openai-models';
import './AIAgentDropdown.css';

const fixedAgentMeta: Record<'auto' | FixedAIProvider, { name: string; shortName: string; description: string; colorClass: string; provider: string }> = {
  'auto':          { name: 'Auto',              shortName: 'Auto',    description: 'Picks the best available model for each task',    colorClass: 'aid-auto',    provider: '' },
  'claude-haiku':  { name: 'Claude Haiku',      shortName: 'Haiku',   description: 'Fastest · ideal for quick questions & summaries', colorClass: 'aid-haiku',   provider: 'Anthropic' },
  'claude-sonnet': { name: 'Claude Sonnet 4.6', shortName: 'Sonnet',  description: 'Balanced · great for analysis & chat',            colorClass: 'aid-sonnet',  provider: 'Anthropic' },
  'claude-opus':   { name: 'Claude Opus 4.6',   shortName: 'Opus',    description: 'Most capable · deep project insights',            colorClass: 'aid-opus',    provider: 'Anthropic' },
  'gpt-4o':        { name: 'GPT-4o',            shortName: 'GPT-4o',  description: 'OpenAI fallback model',                           colorClass: 'aid-gpt4o',   provider: 'OpenAI' },
  'gemini-pro':    { name: 'Gemini 2.5 Flash',  shortName: 'Gemini',  description: 'Google AI Studio · Gemini 2.5 Flash',            colorClass: 'aid-gemini',  provider: 'Google' },
  'genai-mil':     { name: 'GenAI.mil',         shortName: 'GenAI.mil', description: 'DoD GenAI.mil · requires STARK API key',         colorClass: 'aid-genaimil', provider: 'DoD / GenAI.mil' },
};

function getAgentMeta(agent: AIAgentValue) {
  if (agent === 'auto') return fixedAgentMeta.auto;
  if (isOpenAIAgentValue(agent)) {
    const model = agent.slice('openai:'.length);
    return {
      name: model,
      shortName: model,
      description: `OpenAI · ${model}`,
      colorClass: 'aid-gpt4o',
      provider: 'OpenAI',
    };
  }
  return fixedAgentMeta[agent];
}

function getCanonicalOpenAiAgentValue(agent: AIAgentValue, providers: ProviderInfo[]): AIAgentValue {
  if (!isOpenAIAgentValue(agent)) return agent;

  const openAiProvider = providers.find((provider) => provider.id === 'gpt-4o');
  const availableModelIds = (openAiProvider?.visibleModels ?? [])
    .filter((value): value is string => typeof value === 'string' && value.startsWith('openai:'))
    .map((value) => value.slice('openai:'.length));
  const canonicalModelId = canonicalizeOpenAiModelId(agent.slice('openai:'.length), availableModelIds);

  return canonicalModelId ? `openai:${canonicalModelId}` : agent;
}

function StatusBadge({ available, active, serverReachable, status }: {
  available: boolean;
  active: boolean;
  serverReachable: boolean;
  status?: ProviderStatus;
}) {
  if (active) return (
    <span className="aid-badge aid-badge--active">
      <span className="aid-badge-dot aid-badge-dot--pulse" />
      ACTIVE
    </span>
  );
  if (!serverReachable) return <span className="aid-badge aid-badge--offline">Offline</span>;
  if (status === 'no_credits') return <span className="aid-badge aid-badge--nocredits">NO CREDIT</span>;
  if (available) return <span className="aid-badge aid-badge--ready">ACTIVE</span>;
  return <span className="aid-badge aid-badge--nokey">NO KEY</span>;
}

function KeySourceBadge({ keySource }: { keySource?: KeySource }) {
  if (keySource !== 'server') return null;
  return <span className="aid-badge aid-badge--server">Server Key</span>;
}

function getProviderForAgent(id: AIAgentValue, providers: ProviderInfo[]) {
  return providers.find((p) => p.id === (isOpenAIAgentValue(id) ? 'gpt-4o' : id));
}

function toAgentValues(values: string[] | undefined): AIAgentValue[] {
  return (values ?? []).filter((id): id is AIAgentValue => typeof id === 'string' && id.length > 0);
}

function buildProviderGroups(providers: ProviderInfo[]): { label: string; ids: AIAgentValue[] }[] {
  const anthropic: AIAgentValue[] = providers
    .filter((provider) => ['claude-haiku', 'claude-sonnet', 'claude-opus'].includes(provider.id))
    .flatMap((provider) => toAgentValues(provider.visibleModels));
  const openai = toAgentValues(providers.find((provider) => provider.id === 'gpt-4o')?.visibleModels);
  const google = toAgentValues(providers.find((provider) => provider.id === 'gemini-pro')?.visibleModels);
  const genai = toAgentValues(providers.find((provider) => provider.id === 'genai-mil')?.visibleModels);

  return [
    { label: 'Auto', ids: ['auto' as AIAgentValue] },
    { label: 'Anthropic', ids: anthropic },
    { label: 'OpenAI', ids: openai },
    { label: 'Google', ids: google },
    { label: 'DoD / GenAI.mil', ids: genai },
  ].filter((group) => group.label === 'Auto' || group.ids.length > 0);
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

  const displayAgent = getCanonicalOpenAiAgentValue(agent, providers);
  const displayLastUsed = lastUsed ? getCanonicalOpenAiAgentValue(lastUsed, providers) : null;
  const buttonMeta = getAgentMeta(displayAgent);
  const lastUsedMeta = displayLastUsed ? getAgentMeta(displayLastUsed) : null;
  const buttonColorClass = displayAgent === 'auto' ? (lastUsedMeta?.colorClass ?? 'aid-auto') : buttonMeta.colorClass;
  const displayProviderInfo = displayAgent !== 'auto' ? getProviderForAgent(displayAgent, providers) : undefined;
  const lastUsedProviderInfo = displayLastUsed ? getProviderForAgent(displayLastUsed, providers) : undefined;
  const buttonKeySource = displayAgent === 'auto' ? lastUsedProviderInfo?.keySource : displayProviderInfo?.keySource;

  const isAvailable = (id: AIAgentValue) => {
    if (id === 'auto') return true;
    if (!serverReachable) return false;
    const p = getProviderForAgent(id, providers);
    if (!p?.available) return false;
    if (p.status === 'no_credits' || p.status === 'invalid_key' || p.status === 'error') return false;
    return true;
  };

  const readyCount = providers.filter((p) => p.available).length;
  const providerGroups = buildProviderGroups(providers);

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
          {displayAgent === 'auto'
            ? lastUsedMeta ? `Auto · ${lastUsedMeta.shortName}` : 'Auto'
            : buttonMeta.shortName}
        </span>

        <KeySourceBadge keySource={buttonKeySource} />

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
                  {readyCount}/{providers.length} active
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
              {providerGroups.map(({ label, ids }) => {
                const groupIds = ids;
                return (
                  <div key={label}>
                    {label !== 'Auto' && (
                      <div className="px-3 pt-2 pb-1">
                        <span className="text-[9px] tracking-[0.12em] uppercase text-[var(--color-muted)]/50 font-semibold">{label}</span>
                      </div>
                    )}
                    {groupIds.map((id) => {
                      const meta = getAgentMeta(id);
                      const available = isAvailable(id);
                      const isActive = id === displayAgent;
                      const pInfo = id !== 'auto' ? getProviderForAgent(id, providers) : undefined;
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
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`text-xs font-medium truncate ${isActive ? 'text-[var(--color-heading)]' : 'text-[var(--color-text)]'}`}>
                                {meta.name}
                              </div>
                              <KeySourceBadge keySource={pInfo?.keySource} />
                            </div>
                            <div className="text-[10px] text-[var(--color-muted)] truncate">
                              {pInfo?.activeModel
                                ? `${meta.provider} · ${pInfo.activeModel}`
                                : meta.description}
                            </div>
                          </div>

                          <StatusBadge
                            available={available}
                            active={isActive}
                            serverReachable={serverReachable}
                            status={pInfo?.status}
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
              Manage visible models in <strong>Settings → AI Providers</strong>
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
