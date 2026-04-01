import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Search, X, Loader2, Sparkles, Target, Activity, Circle, Loader, AlertTriangle, CheckCircle } from 'lucide-react';
import type { Goal, OdysseyEvent } from '../types';
import { useAIAgent } from '../lib/ai-agent';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface SearchResult {
  id: string;
  score: 'ai' | 'text';
}

export interface SearchPanelHandle {
  focus: () => void;
}

interface SearchPanelProps {
  projectId: string | null;
  goals: Goal[];
  events: OdysseyEvent[];
  onGoalSelect: (goalId: string) => void;
  onEventSelect: () => void;
  /** Legacy — ignored, kept for call-site compatibility */
  onClose?: () => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  not_started: <Circle size={9} className="text-[var(--color-danger)]" />,
  in_progress: <Loader size={9} className="text-[var(--color-accent2)]" />,
  in_review:   <AlertTriangle size={9} className="text-yellow-400" />,
  complete:    <CheckCircle size={9} className="text-[var(--color-accent3)]" />,
};

const SOURCE_COLORS: Record<string, string> = {
  github:   'text-[var(--color-heading)]',
  gitlab:   'text-[var(--color-accent)]',
  teams:    'text-[var(--color-accent2)]',
  onedrive: 'text-[var(--color-accent2)]',
  onenote:  'text-[var(--color-accent3)]',
  manual:   'text-[var(--color-muted)]',
  ai:       'text-[var(--color-accent)]',
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const SearchPanel = forwardRef<SearchPanelHandle, SearchPanelProps>(
  function SearchPanel({ projectId, goals, events, onGoalSelect, onEventSelect }, ref) {
    const { agent } = useAIAgent();
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiGoalIds, setAiGoalIds] = useState<SearchResult[]>([]);
    const [aiEventIds, setAiEventIds] = useState<SearchResult[]>([]);
    const [interpretation, setInterpretation] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const debouncedQuery = useDebounce(query, 250);

    useImperativeHandle(ref, () => ({ focus: () => { inputRef.current?.focus(); setOpen(true); } }));

    // Close on outside click
    useEffect(() => {
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ESC closes dropdown
    useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }, []);

    // Instant text match
    const textMatchedGoals = debouncedQuery.length >= 2
      ? goals.filter(g => g.title.toLowerCase().includes(debouncedQuery.toLowerCase()))
      : [];

    const textMatchedEvents = debouncedQuery.length >= 2
      ? events.filter(e =>
          e.title?.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
          e.summary?.toLowerCase().includes(debouncedQuery.toLowerCase())
        ).slice(0, 6)
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
        setAiGoalIds([]); setAiEventIds([]); setInterpretation(null);
      }
      setSelectedIndex(0);
    }, [debouncedQuery, runAISearch]);

    // Merge results
    const aiGoalIdSet  = new Set(aiGoalIds.map(r => r.id));
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
    const showDropdown = open && query.length >= 2;

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (!showDropdown) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, totalResults - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter' && totalResults > 0) {
        e.preventDefault();
        if (selectedIndex < mergedGoals.length) {
          onGoalSelect(mergedGoals[selectedIndex].goal.id);
          setOpen(false); setQuery('');
        } else {
          onEventSelect();
          setOpen(false);
        }
      }
    };

    const formatDate = (iso: string) =>
      new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
      <div ref={containerRef} className="relative">
        {/* Always-visible search bar */}
        <div className={`flex items-center gap-2 px-3 py-1.5 border rounded-md bg-[var(--color-surface2)] w-52 transition-colors ${open ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-border)]'}`}>
          {aiLoading
            ? <Loader2 size={13} className="shrink-0 text-[var(--color-accent)] animate-spin" />
            : <Search size={13} className="shrink-0 text-[var(--color-muted)]" />
          }
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks…"
            className="flex-1 bg-transparent text-[var(--color-heading)] text-xs font-mono placeholder:text-[var(--color-muted)]/50 focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
              <X size={12} />
            </button>
          )}
        </div>

        {/* Dropdown */}
        {showDropdown && (
          <div className="absolute top-full mt-1 right-0 w-[420px] bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl z-[200] overflow-hidden">

            {/* AI interpretation */}
            {interpretation && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--color-accent)]/5 border-b border-[var(--color-border)]">
                <Sparkles size={9} className="text-[var(--color-accent)] shrink-0" />
                <span className="text-[10px] text-[var(--color-muted)] italic">{interpretation}</span>
              </div>
            )}

            <div className="max-h-[60vh] overflow-y-auto">
              {totalResults === 0 && !aiLoading && (
                <div className="py-6 text-center text-[11px] text-[var(--color-muted)] font-mono">
                  No results for "{query}"
                </div>
              )}

              {aiLoading && totalResults === 0 && (
                <div className="flex items-center gap-2 px-4 py-4 text-[var(--color-muted)]">
                  <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" />
                  <span className="text-[11px] font-mono animate-pulse">Searching with AI…</span>
                </div>
              )}

              {/* Goals */}
              {mergedGoals.length > 0 && (
                <div>
                  <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 border-b border-[var(--color-border)]/40">
                    <Target size={9} className="text-[var(--color-muted)]" />
                    <span className="text-[9px] uppercase tracking-widest text-[var(--color-muted)] font-mono">Tasks</span>
                  </div>
                  {mergedGoals.map(({ goal, score }, i) => (
                    <button
                      key={goal.id}
                      type="button"
                      onClick={() => { onGoalSelect(goal.id); setOpen(false); setQuery(''); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        selectedIndex === i ? 'bg-[var(--color-surface2)]' : 'hover:bg-[var(--color-surface2)]'
                      }`}
                    >
                      <span className="shrink-0">{STATUS_ICONS[goal.status] ?? <Circle size={9} />}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-[var(--color-heading)] truncate">{goal.title}</span>
                          {score === 'ai' && <Sparkles size={8} className="text-[var(--color-accent)] shrink-0" title="AI match" />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {goal.category && <span className="text-[9px] text-[var(--color-muted)] font-mono">{goal.category}</span>}
                          <span className="text-[9px] text-[var(--color-muted)] font-mono">{goal.progress}%</span>
                          {goal.deadline && <span className="text-[9px] text-[var(--color-muted)] font-mono">{formatDate(goal.deadline)}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Events */}
              {mergedEvents.length > 0 && (
                <div className={mergedGoals.length > 0 ? 'border-t border-[var(--color-border)]' : ''}>
                  <div className="px-3 pt-2.5 pb-1 flex items-center gap-1.5 border-b border-[var(--color-border)]/40">
                    <Activity size={9} className="text-[var(--color-muted)]" />
                    <span className="text-[9px] uppercase tracking-widest text-[var(--color-muted)] font-mono">Activity</span>
                  </div>
                  {mergedEvents.map(({ event, score }, i) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => { onEventSelect(); setOpen(false); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        selectedIndex === mergedGoals.length + i ? 'bg-[var(--color-surface2)]' : 'hover:bg-[var(--color-surface2)]'
                      }`}
                    >
                      <span className={`text-[9px] font-mono shrink-0 ${SOURCE_COLORS[event.source] ?? 'text-muted'}`}>[{event.source}]</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs text-[var(--color-heading)] truncate">{event.title ?? event.event_type}</span>
                          {score === 'ai' && <Sparkles size={8} className="text-[var(--color-accent)] shrink-0" title="AI match" />}
                        </div>
                        {event.summary && <p className="text-[9px] text-[var(--color-muted)] truncate mt-0.5">{event.summary}</p>}
                      </div>
                      <span className="text-[9px] text-[var(--color-muted)] font-mono shrink-0">{formatDate(event.occurred_at)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default SearchPanel;
