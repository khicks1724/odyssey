import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export type AIProvider = 'claude-haiku' | 'claude-sonnet' | 'gpt-4o' | 'gemini-pro';

interface ProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
}

interface AIAgentContextType {
  agent: AIProvider;
  setAgent: (agent: AIProvider) => void;
  providers: ProviderInfo[];
  loading: boolean;
}

const AIAgentContext = createContext<AIAgentContextType>({
  agent: 'claude-sonnet',
  setAgent: () => {},
  providers: [],
  loading: true,
});

const STORAGE_KEY = 'odyssey-ai-agent';

export function AIAgentProvider({ children }: { children: ReactNode }) {
  const [agent, setAgentState] = useState<AIProvider>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ['claude-haiku', 'claude-sonnet', 'gpt-4o', 'gemini-pro'].includes(stored)) return stored as AIProvider;
    return 'claude-sonnet';
  });
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ai/providers')
      .then((r) => {
        if (!r.ok) throw new Error(`Providers fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const list: ProviderInfo[] = data.providers || [];
        setProviders(list);
        // If the stored agent isn't available, auto-select the first available one
        const current = list.find((p) => p.id === agent);
        if (!current?.available) {
          const first = list.find((p) => p.available);
          if (first) {
            setAgentState(first.id);
            localStorage.setItem(STORAGE_KEY, first.id);
          }
        }
      })
      .catch((err) => console.error('Failed to load AI providers:', err))
      .finally(() => setLoading(false));
  }, []);

  const setAgent = useCallback((a: AIProvider) => {
    setAgentState(a);
    localStorage.setItem(STORAGE_KEY, a);
  }, []);

  return (
    <AIAgentContext.Provider value={{ agent, setAgent, providers, loading }}>
      {children}
    </AIAgentContext.Provider>
  );
}

export function useAIAgent() {
  return useContext(AIAgentContext);
}
