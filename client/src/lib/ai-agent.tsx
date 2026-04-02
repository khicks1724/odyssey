import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AIProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini-pro' | 'genai-mil';
export type AIAgentValue = AIProvider | 'auto';

export type ProviderStatus = 'ready' | 'no_key' | 'no_credits' | 'invalid_key' | 'error';
export type KeySource = 'user' | 'server' | 'none';

export interface ProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
  status?: ProviderStatus;
  keySource?: KeySource;
  userKeyLinked?: boolean;
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
const ALL_VALUES: AIAgentValue[] = ['auto', 'claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro', 'genai-mil'];

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgentState] = useState<AIAgentValue>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ALL_VALUES.includes(stored as AIAgentValue)) return stored as AIAgentValue;
    return 'auto';
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverReachable, setServerReachable] = useState(true);
  const [lastUsed, setLastUsed] = useState<AIProvider | null>(null);

  const fetchProviders = useCallback(() => {
    setLoading(true);
    fetch('/api/ai/providers')
      .then((r) => {
        if (!r.ok) throw new Error(`Providers fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list: ProviderInfo[] = data.providers || [];
        setProviders(list);
        setServerReachable(true);
        if (agent !== 'auto') {
          const current = list.find((p) => p.id === agent);
          if (!current?.available) {
            setAgentState('auto');
            localStorage.setItem(STORAGE_KEY, 'auto');
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
    <AIAgentContext.Provider value={{ agent, setAgent, providers, loading, serverReachable, lastUsed, notifyModelUsed, refreshProviders: fetchProviders }}>
      {children}
    </AIAgentContext.Provider>
  );
}

export function useAIAgent() {
  return useContext(AIAgentContext);
}
