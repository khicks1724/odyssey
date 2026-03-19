import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AIProvider = 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'gpt-4o' | 'gemini-pro';
export type AIAgentValue = AIProvider | 'auto';

interface ProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
}

interface AIAgentContextType {
  agent: AIAgentValue;
  setAgent: (agent: AIAgentValue) => void;
  providers: ProviderInfo[];
  loading: boolean;
  lastUsed: AIProvider | null;
  notifyModelUsed: (provider: AIProvider) => void;
}

const AIAgentContext = createContext<AIAgentContextType>({
  agent: 'auto',
  setAgent: () => {},
  providers: [],
  loading: true,
  lastUsed: null,
  notifyModelUsed: () => {},
});

const STORAGE_KEY = 'odyssey-ai-agent';
const ALL_VALUES: AIAgentValue[] = ['auto', 'claude-haiku', 'claude-sonnet', 'claude-opus', 'gpt-4o', 'gemini-pro'];

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgentState] = useState<AIAgentValue>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ALL_VALUES.includes(stored as AIAgentValue)) return stored as AIAgentValue;
    return 'auto';
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUsed, setLastUsed] = useState<AIProvider | null>(null);

  useEffect(() => {
    fetch('/api/ai/providers')
      .then((r) => {
        if (!r.ok) throw new Error(`Providers fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list: ProviderInfo[] = data.providers || [];
        setProviders(list);
        // If the stored agent is a specific model that isn't available, switch to auto
        if (agent !== 'auto') {
          const current = list.find((p) => p.id === agent);
          if (!current?.available) {
            setAgentState('auto');
            localStorage.setItem(STORAGE_KEY, 'auto');
          }
        }
      })
      .catch((err) => console.error('Failed to load AI providers:', err))
      .finally(() => setLoading(false));
  }, []);

  const setAgent = useCallback((a: AIAgentValue) => {
    setAgentState(a);
    localStorage.setItem(STORAGE_KEY, a);
  }, []);

  const notifyModelUsed = useCallback((provider: AIProvider) => {
    setLastUsed(provider);
  }, []);

  return (
    <AIAgentContext.Provider value={{ agent, setAgent, providers, loading, lastUsed, notifyModelUsed }}>
      {children}
    </AIAgentContext.Provider>
  );
}

export function useAIAgent() {
  return useContext(AIAgentContext);
}
