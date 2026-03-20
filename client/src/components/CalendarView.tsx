import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Flag, X, Calendar, Loader2 } from 'lucide-react';
import type { Goal } from '../types';
import { supabase } from '../lib/supabase';

const CATEGORY_COLORS: Record<string, string> = {
  Testing:    '#e85555',
  Seeker:     '#3b8eea',
  Missile:    '#e8a235',
  Admin:      '#bd93f9',
  Simulation: '#52c98e',
  DevOps:     '#dc7070',
};
const DEFAULT_COLOR = '#5a6a7e';

const DAYS   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

interface MilestoneEvent { id: string; title: string; date: string; }
interface MemberInfo     { user_id: string; display_name: string | null; }

interface CalendarViewProps {
  goals: Goal[];
  members: MemberInfo[];
  projectId: string;
  onGoalClick: (goal: Goal) => void;
  onCreateGoalForDate: (dateStr: string) => void;
}

function TaskPill({ g, onClick }: { g: Goal; onClick: () => void }) {
  const color = CATEGORY_COLORS[g.category ?? ''] ?? DEFAULT_COLOR;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="w-full min-w-0 overflow-hidden flex items-center gap-1 px-1 py-px rounded text-left hover:brightness-125 shrink-0 transition-all"
      style={{ background: `${color}20`, borderLeft: `2px solid ${color}` }}
      title={g.title}
    >
      <span className="text-[9px] font-mono truncate leading-tight min-w-0 flex-1" style={{ color }}>
        {g.title}
      </span>
    </button>
  );
}

export default function CalendarView({ goals, members: _members, projectId, onGoalClick, onCreateGoalForDate }: CalendarViewProps) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  const [current, setCurrent] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [milestones, setMilestones] = useState<MilestoneEvent[]>([]);
  const [activeDayMenu, setActiveDayMenu] = useState<string | null>(null);
  const [milestoneInput, setMilestoneInput] = useState<{ date: string; title: string } | null>(null);
  const [milestoneLoading, setMilestoneLoading] = useState(false);
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) return;
    supabase
      .from('events')
      .select('id, title, occurred_at')
      .eq('project_id', projectId)
      .eq('event_type', 'milestone')
      .then(({ data }) => {
        if (data) setMilestones(data.map(e => ({ id: e.id, title: e.title ?? 'Milestone', date: e.occurred_at.slice(0, 10) })));
      });
  }, [projectId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveDayMenu(null);
        setMilestoneInput(null);
        setExpandedDay(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const year  = current.getFullYear();
  const month = current.getMonth();
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (string | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = i + 1;
      return `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const numWeeks = cells.length / 7;

  const goalsByDate: Record<string, Goal[]> = {};
  for (const g of goals) {
    if (!g.deadline) continue;
    const key = g.deadline.slice(0, 10);
    (goalsByDate[key] ??= []).push(g);
  }
  const milestonesByDate: Record<string, MilestoneEvent[]> = {};
  for (const m of milestones) {
    (milestonesByDate[m.date] ??= []).push(m);
  }

  const saveMilestone = async () => {
    if (!milestoneInput?.title.trim() || !projectId) return;
    setMilestoneLoading(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData?.session?.user?.id ?? null;
    const { data, error } = await supabase.from('events').insert({
      project_id: projectId,
      source: 'manual',
      event_type: 'milestone',
      title: milestoneInput.title.trim(),
      occurred_at: milestoneInput.date + 'T12:00:00Z',
      actor_id: userId,
    }).select('id, title, occurred_at').single();
    if (!error && data) {
      setMilestones(prev => [...prev, { id: data.id, title: data.title ?? milestoneInput.title, date: milestoneInput.date }]);
    }
    setMilestoneInput(null);
    setActiveDayMenu(null);
    setMilestoneLoading(false);
  };

  const deleteMilestone = async (id: string) => {
    await supabase.from('events').delete().eq('id', id);
    setMilestones(prev => prev.filter(m => m.id !== id));
  };

  // Row height: target ~500px usable grid height spread across numWeeks rows
  // We pin the grid height so it never collapses when empty
  const ROW_PX = Math.max(80, Math.floor(500 / numWeeks));

  return (
    <div ref={containerRef} className="flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden"
      style={{ height: '100%', minHeight: `calc(100vh - 13rem)` }}>

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] shrink-0">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth()-1, 1))}
            className="p-1 rounded hover:bg-[var(--color-surface2)] text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm font-bold text-[var(--color-heading)] font-mono w-44 text-center">
            {MONTHS[month]} {year}
          </span>
          <button type="button" onClick={() => setCurrent(d => new Date(d.getFullYear(), d.getMonth()+1, 1))}
            className="p-1 rounded hover:bg-[var(--color-surface2)] text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
            <ChevronRight size={15} />
          </button>
          <button type="button" onClick={() => setCurrent(new Date(today.getFullYear(), today.getMonth(), 1))}
            className="text-[10px] font-mono px-2 py-0.5 border border-[var(--color-border)] rounded text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-colors ml-1">
            Today
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm" style={{ background: '#bd93f9' }} />
            <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Milestone</span>
          </div>
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
              <span className="text-[9px] font-mono text-[var(--color-muted)]">{cat}</span>
            </div>
          ))}
        </div>

        <div
          title="Microsoft 365 calendar sync — coming soon. Backend integration in progress."
          className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--color-border)]/40 rounded-md opacity-40 cursor-not-allowed select-none"
        >
          <Calendar size={11} className="text-[var(--color-muted)]" />
          <span className="text-[10px] font-mono text-[var(--color-muted)] uppercase tracking-wider">M365 Sync</span>
          <span className="text-[9px] font-mono px-1 py-0.5 bg-[var(--color-surface2)] border border-[var(--color-border)] rounded text-[var(--color-muted)]">Soon</span>
        </div>
      </div>

      {/* ── Day-of-week header ── */}
      <div className="grid grid-cols-7 border-b border-[var(--color-border)] shrink-0 bg-[var(--color-surface2)]/30">
        {DAYS.map(d => (
          <div key={d} className="py-1.5 text-center text-[10px] font-mono uppercase tracking-widest text-[var(--color-muted)]">{d}</div>
        ))}
      </div>

      {/* ── Calendar grid — fixed row heights so empty months stay consistent ── */}
      <div className="flex-1 overflow-y-auto" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: `${ROW_PX}px` }}>
        {cells.map((dateStr, idx) => {
          const isToday       = dateStr === todayStr;
          const isOtherMonth  = !dateStr;
          const dayGoals      = dateStr ? (goalsByDate[dateStr] ?? []) : [];
          const dayMilestones = dateStr ? (milestonesByDate[dateStr] ?? []) : [];
          const isMenuOpen    = activeDayMenu === dateStr;
          const isMsInput     = milestoneInput?.date === dateStr;
          const isExpanded    = expandedDay === dateStr;
          const dayNum        = dateStr ? parseInt(dateStr.slice(8)) : null;
          const isLastCol     = idx % 7 === 6;

          // How many items fit in normal view (header row ~20px, each pill ~17px, gap 1px)
          const maxShown = Math.max(1, Math.floor((ROW_PX - 24) / 18));
          const allItems = [...dayMilestones.map(m => ({ type: 'ms' as const, m })), ...dayGoals.map(g => ({ type: 'goal' as const, g }))];
          const shownItems = allItems.slice(0, maxShown);
          const overflow   = allItems.length - shownItems.length;

          return (
            <div
              key={idx}
              className={`relative border-r border-b border-[var(--color-border)]/30 group flex flex-col ${
                isOtherMonth ? 'bg-[var(--color-surface2)]/10' : 'hover:bg-[var(--color-surface2)]/10'
              } ${isLastCol ? 'border-r-0' : ''} transition-colors`}
              style={{ height: `${ROW_PX}px` }}
            >
              {dateStr && (
                <>
                  {/* Day number + add button */}
                  <div className="flex items-center justify-between px-1.5 pt-1 pb-0.5 shrink-0">
                    <span className={`inline-flex items-center justify-center w-5 h-5 text-[11px] font-mono rounded-full ${
                      isToday ? 'bg-[var(--color-accent)] text-white font-bold' : 'text-[var(--color-muted)]'
                    }`}>
                      {dayNum}
                    </span>
                    <button
                      type="button"
                      title="Add task or milestone"
                      onClick={(e) => { e.stopPropagation(); setActiveDayMenu(isMenuOpen ? null : dateStr); setMilestoneInput(null); setExpandedDay(null); }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[var(--color-muted)] hover:text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-all"
                    >
                      <Plus size={10} />
                    </button>
                  </div>

                  {/* Normal pills view — clipped to cell height */}
                  {!isExpanded && (
                    <div className="flex-1 overflow-hidden px-1 pb-1 flex flex-col gap-px">
                      {shownItems.map((item, ii) => {
                        if (item.type === 'ms') {
                          const m = item.m;
                          return (
                            <div key={`ms-${m.id}`} className="flex items-center gap-1 px-1 py-px rounded min-w-0 group/ms shrink-0"
                              style={{ background: 'rgba(189,147,249,0.12)', borderLeft: '2px solid #bd93f9' }}>
                              <Flag size={7} style={{ color: '#bd93f9' }} className="shrink-0" />
                              <span className="text-[9px] font-mono truncate leading-tight flex-1 min-w-0" style={{ color: '#bd93f9' }}>{m.title}</span>
                              <button type="button" onClick={() => deleteMilestone(m.id)} title="Remove milestone"
                                className="opacity-0 group-hover/ms:opacity-100 transition-opacity hover:text-red-400 shrink-0">
                                <X size={7} />
                              </button>
                            </div>
                          );
                        }
                        const g = item.g;
                        return <TaskPill key={`g-${g.id}-${ii}`} g={g} onClick={() => onGoalClick(g)} />;
                      })}

                      {overflow > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setExpandedDay(dateStr); setActiveDayMenu(null); }}
                          className="text-[9px] text-[var(--color-accent)] font-mono px-1 text-left hover:underline shrink-0"
                        >
                          +{overflow} more
                        </button>
                      )}
                    </div>
                  )}

                  {/* Expanded day overlay — scrollable list of ALL tasks */}
                  {isExpanded && (
                    <div
                      className="absolute inset-x-0 top-0 z-50 bg-[var(--color-surface)] border border-[var(--color-accent)]/30 rounded-lg shadow-2xl flex flex-col"
                      style={{ minHeight: `${ROW_PX}px`, maxHeight: `${ROW_PX * 2.5}px` }}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-2 py-1 border-b border-[var(--color-border)] shrink-0">
                        <span className={`inline-flex items-center justify-center w-5 h-5 text-[11px] font-mono rounded-full ${
                          isToday ? 'bg-[var(--color-accent)] text-white font-bold' : 'text-[var(--color-muted)]'
                        }`}>{dayNum}</span>
                        <span className="text-[9px] font-mono text-[var(--color-muted)]">{allItems.length} items</span>
                        <button type="button" title="Close" onClick={() => setExpandedDay(null)}
                          className="text-[var(--color-muted)] hover:text-[var(--color-heading)] transition-colors">
                          <X size={10} />
                        </button>
                      </div>
                      <div className="flex-1 overflow-y-auto px-1 py-1 flex flex-col gap-px">
                        {dayMilestones.map(m => (
                          <div key={m.id} className="flex items-center gap-1 px-1 py-px rounded min-w-0 group/ms shrink-0"
                            style={{ background: 'rgba(189,147,249,0.12)', borderLeft: '2px solid #bd93f9' }}>
                            <Flag size={7} style={{ color: '#bd93f9' }} className="shrink-0" />
                            <span className="text-[9px] font-mono truncate leading-tight flex-1 min-w-0" style={{ color: '#bd93f9' }}>{m.title}</span>
                            <button type="button" onClick={() => deleteMilestone(m.id)} title="Remove milestone"
                              className="opacity-0 group-hover/ms:opacity-100 transition-opacity hover:text-red-400 shrink-0">
                              <X size={7} />
                            </button>
                          </div>
                        ))}
                        {dayGoals.map(g => (
                          <TaskPill key={g.id} g={g} onClick={() => { onGoalClick(g); setExpandedDay(null); }} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Day action popover */}
                  {isMenuOpen && !isMsInput && (
                    <div
                      className="absolute top-7 right-0 z-50 w-38 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl overflow-hidden"
                      onClick={e => e.stopPropagation()}
                    >
                      <button type="button"
                        onClick={() => { setActiveDayMenu(null); onCreateGoalForDate(dateStr); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-colors text-left"
                      >
                        <Plus size={10} className="text-[var(--color-accent)]" /> Add Task
                      </button>
                      <div className="border-t border-[var(--color-border)]/50" />
                      <button type="button"
                        onClick={() => { setMilestoneInput({ date: dateStr, title: '' }); setActiveDayMenu(null); }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-mono text-[var(--color-heading)] hover:bg-[var(--color-surface2)] transition-colors text-left"
                      >
                        <Flag size={10} style={{ color: '#bd93f9' }} /> Add Milestone
                      </button>
                    </div>
                  )}

                  {/* Milestone inline input */}
                  {isMsInput && (
                    <div
                      className="absolute inset-x-0 top-7 z-50 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-2xl p-2"
                      onClick={e => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1 mb-1.5">
                        <Flag size={9} style={{ color: '#bd93f9' }} />
                        <span className="text-[9px] font-mono text-[var(--color-muted)] uppercase tracking-wider">Milestone</span>
                      </div>
                      <input
                        autoFocus
                        type="text"
                        placeholder="Name this milestone…"
                        value={milestoneInput.title}
                        onChange={e => setMilestoneInput(p => p ? { ...p, title: e.target.value } : p)}
                        onKeyDown={e => { if (e.key === 'Enter') saveMilestone(); if (e.key === 'Escape') setMilestoneInput(null); }}
                        className="w-full bg-[var(--color-surface2)] border border-[var(--color-border)] rounded px-2 py-1 text-[10px] font-mono text-[var(--color-heading)] focus:outline-none focus:border-[var(--color-accent)]/50 mb-1.5 placeholder:text-[var(--color-muted)]/50"
                      />
                      <div className="flex gap-1">
                        <button type="button" onClick={saveMilestone}
                          disabled={milestoneLoading || !milestoneInput.title.trim()}
                          className="flex-1 flex items-center justify-center gap-1 px-2 py-1 bg-[var(--color-accent)] text-white text-[9px] font-mono rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                        >
                          {milestoneLoading ? <Loader2 size={8} className="animate-spin" /> : <Flag size={8} />}
                          Save
                        </button>
                        <button type="button" title="Cancel" onClick={() => setMilestoneInput(null)}
                          className="px-2 py-1 border border-[var(--color-border)] text-[var(--color-muted)] text-[9px] font-mono rounded hover:text-[var(--color-heading)] transition-colors"
                        >
                          <X size={8} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
