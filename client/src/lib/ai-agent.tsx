import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from './supabase';
import { canonicalizeOpenAiModelId } from './openai-models';

export type FixedAIProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini-pro' | 'genai-mil' | 'nvidia' | 'gemma4';
export type OpenAIAgentValue = `openai:${string}`;
export type AIProvider = FixedAIProvider | OpenAIAgentValue;
export type AIAgentValue = AIProvider | 'auto';

export type ProviderStatus = 'ready' | 'no_key' | 'no_credits' | 'invalid_key' | 'error';
export type KeySource = 'user' | 'server' | 'none';

export interface ProviderInfo {
  id: FixedAIProvider;
  name: string;
  available: boolean;
  status?: ProviderStatus;
  keySource?: KeySource;
  userKeyLinked?: boolean;
  activeModel?: string;
  models?: string[];
  visibleModels?: string[];
}

interface AIAgentContextType {
  agent: AIAgentValue;
  setAgent: (agent: AIAgentValue) => void;
  providers: ProviderInfo[];
  loading: boolean;
  serverReachable: boolean;
  lastUsed: AIProvider | null;
  notifyModelUsed: (provider: AIProvider) => void;
  refreshProviders: () => void;
}

const AIAgentContext = createContext<AIAgentContextType>({
  agent: 'auto',
  setAgent: () => {},
  providers: [],
  loading: true,
  serverReachable: true,
  lastUsed: null,
  notifyModelUsed: () => {},
  refreshProviders: () => {},
});

const STORAGE_KEY = 'odyssey-ai-agent-v2'; // v2 = auto default; bumped to clear old stored model
const PROVIDERS_TTL_MS = 5 * 60 * 1000; // re-fetch at most once every 5 minutes
let lastProvidersFetch = 0;
const FIXED_VALUES: FixedAIProvider[] = ['claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro', 'genai-mil', 'nvidia', 'gemma4'];

export function isOpenAIAgentValue(value: string): value is OpenAIAgentValue {
  return value.startsWith('openai:') && value.slice('openai:'.length).trim().length > 0;
}

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgentState] = useState<AIAgentValue>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (stored === 'auto' || FIXED_VALUES.includes(stored as FixedAIProvider) || isOpenAIAgentValue(stored))) {
      return stored as AIAgentValue;
    }
    return 'auto';
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverReachable, setServerReachable] = useState(true);
  const [lastUsed, setLastUsed] = useState<AIProvider | null>(null);

  const fetchProviders = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastProvidersFetch < PROVIDERS_TTL_MS) return;
    lastProvidersFetch = now;
    setLoading(true);
    supabase.auth.getSession().then(({ data: { session } }) => {
      const headers: Record<string, string> = {};
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
      return fetch(`/api/ai/providers${force ? '?refresh=1' : ''}`, { headers });
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Providers fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list: ProviderInfo[] = data.providers || [];
        setProviders(list);
        setServerReachable(true);
        if (agent !== 'auto') {
          if (isOpenAIAgentValue(agent)) {
            const current = list.find((p) => p.id === 'gpt-4o');
            const modelId = agent.slice('openai:'.length);
            const availableModelIds = (current?.visibleModels ?? [])
              .filter((value): value is string => typeof value === 'string' && value.startsWith('openai:'))
              .map((value) => value.slice('openai:'.length));
            const canonicalModelId = canonicalizeOpenAiModelId(modelId, availableModelIds);
            const canonicalAgent = (`openai:${canonicalModelId}`) as AIAgentValue;
            if (canonicalModelId && canonicalAgent !== agent && current?.visibleModels?.includes(canonicalAgent)) {
              setAgentState(canonicalAgent);
              localStorage.setItem(STORAGE_KEY, canonicalAgent);
            }
          }
        }
      })
      .catch(() => {
        setServerReachable(false);
      })
      .finally(() => setLoading(false));
  }, [agent]);

  useEffect(() => { fetchProviders(); }, []);

  const setAgent = useCallback((a: AIAgentValue) => {
    setAgentState(a);
    localStorage.setItem(STORAGE_KEY, a);
  }, []);

  const notifyModelUsed = useCallback((provider: AIProvider) => {
    setLastUsed(provider);
  }, []);

  return (
    <AIAgentContext.Provider value={{ agent, setAgent, providers, loading, serverReachable, lastUsed, notifyModelUsed, refreshProviders: () => fetchProviders(true) }}>
      {children}
    </AIAgentContext.Provider>
  );
}

export function useAIAgent() {
  return useContext(AIAgentContext);
}
