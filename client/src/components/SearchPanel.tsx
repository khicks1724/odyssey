import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, Sparkles, Target, Activity, Circle, Loader, AlertTriangle, CheckCircle } from 'lucide-react';
import type { Goal, OdysseyEvent } from '../types';
import { useAIAgent } from '../lib/ai-agent';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface SearchResult {
  id: string;
  score: 'ai' | 'text';
}

interface SearchPanelProps {
  projectId: string | null;
  goals: Goal[];
  events: OdysseyEvent[];
  onClose: () => void;
  onGoalSelect: (goalId: string) => void;
  onEventSelect: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  not_started: <Circle size={9} className="text-[var(--color-danger)]" />,
  in_progress: <Loader size={9} className="text-[var(--color-accent2)]" />,
  in_review:   <AlertTriangle size={9} className="text-yellow-400" />,
  complete:    <CheckCircle size={9} className="text-[var(--color-accent3)]" />,
};

const SOURCE_COLORS: Record<string, string> = {
  github:  'text-[var(--color-heading)]',
  gitlab:  'text-[var(--color-accent)]',
  teams:   'text-[var(--color-accent2)]',
  onedrive:'text-[var(--color-accent2)]',
  onenote: 'text-[var(--color-accent3)]',
  manual:  'text-[var(--color-muted)]',
  ai:      'text-[var(--color-accent)]',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function SearchPanel({ projectId, goals, events, onClose, onGoalSelect, onEventSelect }: SearchPanelProps) {
  const { agent } = useAIAgent();
  const [query, setQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiGoalIds, setAiGoalIds] = useState<SearchResult[]>([]);
  const [aiEventIds, setAiEventIds] = useState<SearchResult[]>([]);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 250);

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Instant text match
  const textMatchedGoals = debouncedQuery.length >= 2
    ? goals.filter(g => g.title.toLowerCase().includes(debouncedQuery.toLowerCase()))
    : [];

  const textMatchedEvents = debouncedQuery.length >= 2
    ? events.filter(e =>
        e.title?.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        e.summary?.toLowerCase().includes(debouncedQuery.toLowerCase())
      ).slice(0, 10)
    : [];

  // AI search
  const runAISearch = useCallback(async (q: string) => {
    if (!projectId || q.length < 3) { setAiGoalIds([]); setAiEventIds([]); setInterpretation(null); return; }
    setAiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/ai/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, query: q, agent }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiGoalIds(data.goals ?? []);
        setAiEventIds(data.events ?? []);
        setInterpretation(data.interpretation ?? null);
      }
    } catch { /* ignore */ }
    setAiLoading(false);
  }, [projectId, agent]);

  useEffect(() => {
    if (debouncedQuery.length >= 3) {
      runAISearch(debouncedQuery);
    } else {
      setAiGoalIds([]);
      setAiEventIds([]);
      setInterpretation(null);
    }
    setSelectedIndex(0);
  }, [debouncedQuery, runAISearch]);

  // Merge results: AI first, then text-only, deduplicated
  const aiGoalIdSet = new Set(aiGoalIds.map(r => r.id));
  const aiEventIdSet = new Set(aiEventIds.map(r => r.id));

  const mergedGoals: { goal: Goal; score: 'ai' | 'text' }[] = [
    ...aiGoalIds.map(r => ({ goal: goals.find(g => g.id === r.id)!, score: r.score })).filter(r => r.goal),
    ...textMatchedGoals.filter(g => !aiGoalIdSet.has(g.id)).map(g => ({ goal: g, score: 'text' as const })),
  ].slice(0, 8);

  const mergedEvents: { event: OdysseyEvent; score: 'ai' | 'text' }[] = [
    ...aiEventIds.map(r => ({ event: events.find(e => e.id === r.id)!, score: r.score })).filter(r => r.event),
    ...textMatchedEvents.filter(e => !aiEventIdSet.has(e.id)).map(e => ({ event: e, score: 'text' as const })),
  ].slice(0, 6);

  const totalResults = mergedGoals.length + mergedEvents.length;

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, totalResults - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && totalResults > 0) {
      e.preventDefault();
      if (selectedIndex < mergedGoals.length) {
        onGoalSelect(mergedGoals[selectedIndex].goal.id);
        onClose();
      } else {
        onEventSelect();
        onClose();
      }
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center pt-14 px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-xl bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
          {aiLoading
            ? <Loader2 size={14} className="text-[var(--color-accent)] shrink-0 animate-spin" />
            : <Search size={14} className="text-[var(--color-muted)] shrink-0" />
          }
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Search tasks, events… or ask "tasks due this week"'
            className="flex-1 bg-transparent text-[var(--color-heading)] text-sm font-mono placeholder:text-[var(--color-muted)]/50 focus:outline-none"
          />
          {query && (
            <button onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
              <X size={13} />
            </button>
          )}
          <kbd className="hidden sm:inline-flex text-[9px] text-[var(--color-muted)] border border-[var(--color-border)] rounded px-1.5 py-0.5 font-mono">ESC</kbd>
        </div>

        {/* AI interpretation */}
        {interpretation && (
          <div className="flex items-center gap-1.5 px-4 py-1.5 bg-[var(--color-accent)]/5 border-b border-[var(--color-border)]">
            <Sparkles size={10} className="text-[var(--color-accent)] shrink-0" />
            <span className="text-[10px] text-[var(--color-muted)] italic">{interpretation}</span>
          </div>
        )}

        {/* Results */}
        {query.length >= 2 && (
          <div className="max-h-[60vh] overflow-y-auto">
            {totalResults === 0 && !aiLoading && (
              <div className="py-8 text-center text-[11px] text-[var(--color-muted)] font-mono">
                No results found for "{query}"
              </div>
            )}

            {/* Goals section */}
            {mergedGoals.length > 0 && (
              <div>
                <div className="px-4 pt-3 pb-1 flex items-center gap-1.5">
                  <Target size={10} className="text-[var(--color-muted)]" />
                  <span className="text-[9px] uppercase tracking-widest text-[var(--color-muted)]">Tasks</span>
                </div>
                {mergedGoals.map(({ goal, score }, i) => (
                  <button
                    key={goal.id}
                    type="button"
                    onClick={() => { onGoalSelect(goal.id); onClose(); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      selectedIndex === i
                        ? 'bg-[var(--color-surface2)]'
                        : 'hover:bg-[var(--color-surface2)]'
                    }`}
                  >
                    <span className="shrink-0">{STATUS_ICONS[goal.status] ?? <Circle size={9} />}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--color-heading)] truncate">{goal.title}</span>
                        {score === 'ai' && (
                          <Sparkles size={8} className="text-[var(--color-accent)] shrink-0" title="AI match" />
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {goal.category && (
                          <span className="text-[9px] text-[var(--color-muted)] font-mono">{goal.category}</span>
                        )}
                        <span className="text-[9px] text-[var(--color-muted)] font-mono">{goal.progress}%</span>
                        {goal.deadline && (
                          <span className="text-[9px] text-[var(--color-muted)] font-mono">{goal.deadline}</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Events section */}
            {mergedEvents.length > 0 && (
              <div className={mergedGoals.length > 0 ? 'border-t border-[var(--color-border)]' : ''}>
                <div className="px-4 pt-3 pb-1 flex items-center gap-1.5">
                  <Activity size={10} className="text-[var(--color-muted)]" />
                  <span className="text-[9px] uppercase tracking-widest text-[var(--color-muted)]">Activity</span>
                </div>
                {mergedEvents.map(({ event, score }, i) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => { onEventSelect(); onClose(); }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      selectedIndex === mergedGoals.length + i
                        ? 'bg-[var(--color-surface2)]'
                        : 'hover:bg-[var(--color-surface2)]'
                    }`}
                  >
                    <span className={`text-[9px] font-mono shrink-0 ${SOURCE_COLORS[event.source] ?? 'text-muted'}`}>
                      [{event.source}]
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--color-heading)] truncate">{event.title ?? event.event_type}</span>
                        {score === 'ai' && (
                          <Sparkles size={8} className="text-[var(--color-accent)] shrink-0" title="AI match" />
                        )}
                      </div>
                      {event.summary && (
                        <p className="text-[9px] text-[var(--color-muted)] truncate mt-0.5">{event.summary}</p>
                      )}
                    </div>
                    <span className="text-[9px] text-[var(--color-muted)] font-mono shrink-0">
                      {formatDate(event.occurred_at)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Empty / hint state */}
        {query.length < 2 && (
          <div className="py-6 px-4 text-center">
            <p className="text-[11px] text-[var(--color-muted)] font-mono mb-3">
              Search goals, events, and activity
            </p>
            <div className="flex flex-wrap justify-center gap-1.5">
              {['tasks due this week', 'what was completed?', 'at-risk tasks', 'recent commits'].map(hint => (
                <button key={hint} type="button" onClick={() => setQuery(hint)}
                  className="text-[9px] px-2.5 py-1 border border-[var(--color-border)] rounded text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-colors font-mono">
                  {hint}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        {!projectId && (
          <div className="px-4 py-2 border-t border-[var(--color-border)] text-[9px] text-[var(--color-muted)] font-mono text-center">
            Open a project to enable full search
          </div>
        )}
      </div>
    </div>
  );
}
