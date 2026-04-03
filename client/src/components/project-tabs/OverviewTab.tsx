import React, { useState, useRef } from 'react';
import {
  Activity,
  Users,
  Target,
  Github,
  Sparkles,
  BarChart3,
  Clock,
  CheckCircle,
  X,
  TrendingUp,
  GitBranch,
  ClipboardList,
  Loader2,
  Plus,
  HelpCircle,
} from 'lucide-react';
import ActivityFeed from '../ActivityFeed';
import CommitActivityCharts from '../CommitActivityCharts';
import Timeline from '../Timeline';
import MarkdownWithFileLinks from '../MarkdownWithFileLinks';
import FilterDropdown from '../FilterDropdown';
import { fmtDate } from '../../lib/time-format';
import type { FileRef } from '../../hooks/useProjectFilePaths';
import type { Goal, OdysseyEvent } from '../../types';

const RFI_FILTER_KEYS = { category: 'category', loe: 'loe', assignee: 'assignee' } as const;

// ── RFI Types ────────────────────────────────────────────────────────────────

interface RFI {
  id: string;
  text: string;
  category: string;
  loe: string;
  assignees: string[]; // user_ids
  suspenseDate: string; // ISO date string or ''
  createdAt: string;
  createdByName: string;
}

// ── RFI Add Modal ─────────────────────────────────────────────────────────────

interface AddRFIModalProps {
  members: { user_id: string; display_name: string | null }[];
  currentUserName: string;
  currentUserId: string;
  categoryLabels: { id: string; name: string }[];
  loeLabels: { id: string; name: string }[];
  onAdd: (rfi: Omit<RFI, 'id' | 'createdAt' | 'createdByName'>) => void;
  onClose: () => void;
}

function AddRFIModal({ members, currentUserName, currentUserId, categoryLabels, loeLabels, onAdd, onClose }: AddRFIModalProps) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [loe, setLoe] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [suspenseDate, setSuspenseDate] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  const allPeople = [
    { user_id: currentUserId, display_name: currentUserName },
    ...members,
  ];

  const toggleAssignee = (id: string) =>
    setAssignees((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onAdd({ text: text.trim(), category, loe, assignees, suspenseDate });
    onClose();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-surface border border-border rounded w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <HelpCircle size={14} className="text-accent" />
            <span className="font-sans text-sm font-bold text-heading">Add RFI</span>
          </div>
          <button type="button" onClick={onClose} title="Close" aria-label="Close" className="text-muted hover:text-heading transition-colors">
            <X size={14} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[10px] font-mono uppercase text-muted mb-1">Request *</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Describe the information needed…"
              className="w-full bg-surface2 border border-border rounded px-3 py-2 text-xs text-heading placeholder-muted resize-none focus:outline-none focus:border-accent/50"
              autoFocus
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-muted mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
              className="w-full bg-surface2 border border-border rounded px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-accent/50 cursor-pointer"
            >
              <option value="">— None —</option>
              {categoryLabels.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>

          {/* LOE */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-muted mb-1">Line of Effort</label>
            <select
              value={loe}
              onChange={(e) => setLoe(e.target.value)}
              aria-label="Level of Effort"
              className="w-full bg-surface2 border border-border rounded px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-accent/50 cursor-pointer"
            >
              <option value="">— None —</option>
              {loeLabels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </div>

          {/* Suspense Date */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-muted mb-1">Suspense Date</label>
            <input
              type="date"
              value={suspenseDate}
              onChange={(e) => setSuspenseDate(e.target.value)}
              aria-label="Suspense Date"
              className="w-full bg-surface2 border border-border rounded px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-accent/50"
            />
          </div>

          {/* Assignees */}
          <div>
            <label className="block text-[10px] font-mono uppercase text-muted mb-1">Assign To</label>
            <div className="space-y-px border border-border rounded overflow-hidden">
              {allPeople.map((p) => {
                const checked = assignees.includes(p.user_id);
                return (
                  <label
                    key={p.user_id}
                    className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-surface2 transition-colors"
                  >
                    <span className={`w-3 h-3 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors ${
                      checked ? 'bg-accent border-accent' : 'border-border'
                    }`}>
                      {checked && (
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="text-xs text-heading truncate">{p.display_name ?? p.user_id}</span>
                    <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleAssignee(p.user_id)} />
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-[10px] font-mono text-muted border border-border rounded hover:text-heading transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!text.trim()}
              className="px-3 py-1.5 text-[10px] font-mono bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add RFI
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── RFI Section ───────────────────────────────────────────────────────────────

interface RFISectionProps {
  members: { user_id: string; display_name: string | null }[];
  currentUserName: string;
  currentUserId: string;
  categoryLabels: { id: string; name: string }[];
  loeLabels: { id: string; name: string }[];
}

function RFISection({ members, currentUserName, currentUserId, categoryLabels, loeLabels }: RFISectionProps) {
  const [rfis, setRfis] = useState<RFI[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [filterCats, setFilterCats] = useState<string[]>([]);
  const [filterLoes, setFilterLoes] = useState<string[]>([]);
  const [filterAssignees, setFilterAssignees] = useState<string[]>([]);

  const allPeople = [
    { user_id: currentUserId, display_name: currentUserName },
    ...members,
  ];

  const allCategories = [...new Set(rfis.map((r) => r.category).filter(Boolean))];
  const allLoes = [...new Set(rfis.map((r) => r.loe).filter(Boolean))];
  const allAssigneeIds = [...new Set(rfis.flatMap((r) => r.assignees))];
  const allAssigneeOptions = allAssigneeIds.map((id) => ({
    value: id,
    label: allPeople.find((p) => p.user_id === id)?.display_name ?? id,
  }));

  const filtered = rfis.filter((r) => {
    if (filterCats.length > 0 && !filterCats.includes(r.category)) return false;
    if (filterLoes.length > 0 && !filterLoes.includes(r.loe)) return false;
    if (filterAssignees.length > 0 && !filterAssignees.some((a) => r.assignees.includes(a))) return false;
    return true;
  });

  const handleAdd = (data: Omit<RFI, 'id' | 'createdAt' | 'createdByName'>) => {
    setRfis((prev) => [...prev, {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      createdByName: currentUserName,
    }]);
  };

  const handleRemove = (id: string) => setRfis((prev) => prev.filter((r) => r.id !== id));

  const hasFilters = allCategories.length > 0 || allLoes.length > 0 || allAssigneeOptions.length > 0;
  const filterSections = [
    ...(allCategories.length > 0 ? [{ key: RFI_FILTER_KEYS.category, label: 'Categories', options: allCategories.map((c) => ({ value: c, label: c })), selected: filterCats }] : []),
    ...(allLoes.length > 0 ? [{ key: RFI_FILTER_KEYS.loe, label: 'LOEs', options: allLoes.map((l) => ({ value: l, label: l })), selected: filterLoes }] : []),
    ...(allAssigneeOptions.length > 0 ? [{ key: RFI_FILTER_KEYS.assignee, label: 'Assignees', options: allAssigneeOptions, selected: filterAssignees }] : []),
  ];

  return (
    <div className="border border-border bg-surface p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <HelpCircle size={14} className="text-accent" />
          <h3 className="font-sans text-sm font-bold text-heading">RFIs</h3>
          <span className="text-[10px] text-muted font-mono bg-surface2 px-1.5 py-0.5 rounded">{rfis.length}</span>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && filterSections.length > 0 && (
            <FilterDropdown
              placeholder="Filters"
              sections={filterSections}
              onChange={(key, selected) => {
                if (key === RFI_FILTER_KEYS.category) setFilterCats(selected);
                else if (key === RFI_FILTER_KEYS.loe) setFilterLoes(selected);
                else if (key === RFI_FILTER_KEYS.assignee) setFilterAssignees(selected);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-mono bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors cursor-pointer"
          >
            <Plus size={10} />
            Add RFI
          </button>
        </div>
      </div>

      {rfis.length === 0 ? (
        <p className="text-xs text-muted py-4 text-center">No RFIs yet. Click + Add RFI to submit a request for information.</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted py-4 text-center">No RFIs match the current filters.</p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((rfi) => {
            const assigneeNames = rfi.assignees
              .map((id) => allPeople.find((p) => p.user_id === id)?.display_name ?? id)
              .filter(Boolean);
            return (
              <li key={rfi.id} className="flex items-start gap-3 group">
                <span className="text-accent mt-0.5 shrink-0 text-sm">•</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-heading leading-snug">{rfi.text}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
                    <span className="text-[10px] text-muted font-mono">
                      {fmtDate(rfi.createdAt, { month: 'short', day: 'numeric', year: 'numeric' })} · {rfi.createdByName}
                    </span>
                    {rfi.category && (
                      <span className="text-[10px] font-mono text-accent2">{rfi.category}</span>
                    )}
                    {rfi.loe && (
                      <span className="text-[10px] font-mono px-1.5 py-0 border border-border rounded text-muted">{rfi.loe}</span>
                    )}
                    {rfi.suspenseDate && (
                      <span className="text-[10px] font-mono text-yellow-500">
                        Due {fmtDate(rfi.suspenseDate + 'T00:00:00', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    )}
                    {assigneeNames.length > 0 && (
                      <span className="text-[10px] text-muted font-mono">→ {assigneeNames.join(', ')}</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(rfi.id)}
                  className="opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-all mt-0.5 shrink-0"
                  title="Remove RFI"
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {showModal && (
        <AddRFIModal
          members={members}
          currentUserName={currentUserName}
          currentUserId={currentUserId}
          categoryLabels={categoryLabels}
          loeLabels={loeLabels}
          onAdd={handleAdd}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null };
}

type StandupData = {
  highlights: string;
  accomplished: string[];
  inProgress: string[];
  blockers: string[];
  period: { from: string; to: string };
  commitSummary: { source: 'github' | 'gitlab'; repo: string; count: number }[];
  totalCommits: number;
  provider?: string;
};

export interface OverviewTabProps {
  project: {
    id: string;
    name: string;
    github_repo?: string | null;
    description?: string | null;
  };
  goals: Goal[];
  completedGoals: Goal[];
  activeGoals: Goal[];
  overallProgress: number;
  members: MemberRow[];
  events: OdysseyEvent[];
  eventsLoading: boolean;
  user: { id?: string; user_metadata?: { user_name?: string; avatar_url?: string; email?: string }; email?: string } | null;
  hasCommitData: boolean;
  setHasCommitData: (v: boolean) => void;
  gitlabRepos: string[];
  filePaths: string[];
  insights: {
    status: string;
    nextSteps: string[];
    futureFeatures: string[];
    codeInsights?: string[];
    provider?: string;
    generatedAt?: string;
  } | null;
  insightsLoading: boolean;
  insightsError: string | null;
  standup: StandupData | null;
  standupLoading: boolean;
  standupError: string | null;
  handleGenerateInsights: () => void;
  handleGenerateStandup: () => void;
  handleFileClick: (ref: FileRef) => void;
  handleRepoClick: (repo: string, type: 'github' | 'gitlab') => void;
  setEditGoal: (goal: Goal | null) => void;
  setEditAutoGuidance: (v: boolean) => void;
  setActiveTab: (tab: string) => void;
  handlePromoteMember: (userId: string) => void;
  categoryLabels: { id: string; name: string }[];
  loeLabels: { id: string; name: string }[];
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-heading font-sans font-semibold">{value}</span>
    </div>
  );
}

function OverviewTab({
  project,
  goals,
  completedGoals,
  overallProgress,
  members,
  events,
  eventsLoading,
  user,
  hasCommitData,
  setHasCommitData,
  gitlabRepos,
  filePaths,
  insights,
  insightsLoading,
  insightsError,
  standup,
  standupLoading,
  standupError,
  handleGenerateInsights,
  handleGenerateStandup,
  handleFileClick,
  handleRepoClick,
  setEditGoal,
  setEditAutoGuidance,
  setActiveTab,
  handlePromoteMember,
  categoryLabels,
  loeLabels,
}: OverviewTabProps) {
  return (
    <>
      {/* Stats + Integrations + AI */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border border border-border mb-8">
        <div className="bg-surface p-6">
          <h3 className="font-sans text-sm font-bold text-heading mb-4">Project Status</h3>
          <div className="space-y-3">
            <StatRow label="Tasks" value={`${completedGoals.length} / ${goals.length}`} />
            <StatRow label="Overall Progress" value={`${overallProgress}%`} />
            <StatRow label="Members" value={String(members.length || 1)} />
            <StatRow label="Events" value={String(events.length)} />
            {(() => {
              const now = Date.now();
              const overdueCount = goals.filter(
                (g) => g.deadline && new Date(g.deadline).getTime() < now && g.status !== 'complete'
              ).length;
              const soonCount = goals.filter((g) => {
                if (!g.deadline || g.status === 'complete') return false;
                const ms = new Date(g.deadline).getTime() - now;
                return ms > 0 && ms < 14 * 86_400_000 && g.progress < 75;
              }).length;
              const completionRate = goals.length > 0 ? completedGoals.length / goals.length : 0;

              let label: string;
              let color: string;
              if (overdueCount > 0) {
                label = `At Risk · ${overdueCount} overdue`;
                color = 'text-red-400';
              } else if (soonCount > 0) {
                label = `Caution · ${soonCount} due soon`;
                color = 'text-yellow-400';
              } else if (completionRate >= 0.5 || overallProgress >= 60) {
                label = 'On Track';
                color = 'text-green-500';
              } else if (goals.length === 0) {
                label = 'No tasks yet';
                color = 'text-muted';
              } else {
                label = 'Early Stage';
                color = 'text-muted';
              }
              return (
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-muted">Trajectory</span>
                  <span className={`text-xs font-mono font-medium ${color}`}>{label}</span>
                </div>
              );
            })()}
          </div>
        </div>
        <div className="bg-surface p-6">
          <h3 className="font-sans text-sm font-bold text-heading mb-4">Integrations</h3>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <Github size={16} className={project.github_repo ? 'text-accent' : 'text-muted'} />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-medium">GitHub</div>
                {project.github_repo ? (
                  <a
                    href={`https://github.com/${project.github_repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-accent hover:underline truncate block"
                  >
                    {project.github_repo}
                  </a>
                ) : (
                  <div className="text-[10px] text-muted">Not connected</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="text-[10px] text-accent hover:underline"
              >
                {project.github_repo ? 'Manage' : 'Connect'}
              </button>
            </div>
            <div className="flex items-center gap-3 p-3 border border-border rounded">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className={gitlabRepos.length > 0 ? 'text-[#FC6D26]' : 'text-muted'}>
                <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 01-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 014.82 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0118.6 2a.43.43 0 01.58 0 .42.42 0 01.11.18l2.44 7.51 1.22 3.78a.84.84 0 01-.3.92z"/>
              </svg>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-medium">GitLab <span className="text-[9px] text-muted font-mono">NPS</span></div>
                {gitlabRepos.length > 0 ? (
                  <div className="text-[10px] text-muted truncate">
                    {gitlabRepos.length === 1 ? gitlabRepos[0] : `${gitlabRepos.length} repos linked`}
                  </div>
                ) : (
                  <div className="text-[10px] text-muted">Not connected</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="text-[10px] text-accent hover:underline"
              >
                {gitlabRepos.length > 0 ? 'Manage' : 'Connect'}
              </button>
            </div>
          </div>
        </div>
        <div className="bg-surface p-6 flex flex-col gap-5">
          {/* AI Insights */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={14} className="text-accent" />
                <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
              </div>
              <button
                type="button"
                onClick={handleGenerateInsights}
                disabled={insightsLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase font-medium
                           bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {insightsLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                {insightsLoading ? 'Analyzing…' : insights ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              {insights ? `Last run ${new Date(insights.generatedAt ?? '').toLocaleDateString()}` : 'Project status, next steps, and feature ideas.'}
            </p>
          </div>

          <div className="border-t border-border" />

          {/* 2-Week Standup */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ClipboardList size={14} className="text-accent" />
                <h3 className="font-sans text-sm font-bold text-heading">2-Week Standup</h3>
              </div>
              <button
                type="button"
                onClick={handleGenerateStandup}
                disabled={standupLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider uppercase font-medium
                           bg-accent/10 text-accent border border-accent/20 rounded hover:bg-accent/20 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {standupLoading ? <Loader2 size={10} className="animate-spin" /> : <ClipboardList size={10} />}
                {standupLoading ? 'Generating…' : standup ? 'Regenerate' : 'Generate'}
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              {standup ? `${standup.totalCommits} commits · ${standup.period.from} → ${standup.period.to}` : 'Summarizes commits, goals, and activity from the last 14 days.'}
            </p>
          </div>
        </div>
      </div>

      {/* RFIs */}
      <RFISection
        members={members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? null }))}
        currentUserName={user?.user_metadata?.user_name ?? user?.email ?? 'You'}
        currentUserId={user?.id ?? ''}
        categoryLabels={categoryLabels}
        loeLabels={loeLabels}
      />

      {/* AI Insights Results */}
      {(insights || insightsLoading || insightsError) && (
        <div className="border border-border bg-surface p-6 mb-8">
          {/* Header row — always visible */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h3 className="font-sans text-sm font-bold text-heading">AI Insights</h3>
            </div>
            {insights && (
              <div className="flex flex-col items-end gap-0.5">
                {insights.generatedAt && (
                  <div className="flex items-center gap-1 text-[10px] text-muted">
                    <Clock size={9} />
                    {new Date(insights.generatedAt).toLocaleString()}
                  </div>
                )}
                {insights.provider && (
                  <div className="flex items-center gap-1 text-[10px] text-muted">
                    <CheckCircle size={9} className="text-green-500" />
                    <span>{insights.provider}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {insightsLoading ? (
            <div className="flex items-center justify-center gap-3 py-12">
              <Loader2 size={20} className="animate-spin text-accent" />
              <span className="text-sm text-muted">Analyzing project with AI…</span>
            </div>
          ) : insightsError ? (
            <div className="flex items-center gap-3 p-4 border border-red-300/30 bg-red-500/5 rounded">
              <X size={16} className="text-red-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-heading mb-0.5">Insights generation failed</p>
                <p className="text-[11px] text-muted">{insightsError}</p>
                <p className="text-[10px] text-muted mt-1">Try selecting a different AI model from the dropdown and clicking Generate again.</p>
              </div>
            </div>
          ) : insights && (
            <div className="space-y-6">

              {/* Project Status */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <BarChart3 size={14} className="text-accent" />
                  <h4 className="font-sans text-base font-bold text-heading">Project Status</h4>
                </div>
                <div className="text-xs text-muted leading-relaxed pl-5">
                  <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>
                    {insights.status}
                  </MarkdownWithFileLinks>
                </div>
              </div>

              {/* Next Steps */}
              {insights.nextSteps?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Target size={14} className="text-accent2" />
                    <h4 className="font-sans text-base font-bold text-heading">What to Work on Next</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {insights.nextSteps.map((step: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-accent font-mono text-[10px] mt-0.5 shrink-0">{i + 1}.</span>
                        <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{step}</MarkdownWithFileLinks>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Future Features */}
              {insights.futureFeatures?.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles size={14} className="text-yellow-500" />
                    <h4 className="font-sans text-base font-bold text-heading">Future Feature Ideas</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {insights.futureFeatures.map((feat: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-yellow-500 shrink-0">◆</span>
                        <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{feat}</MarkdownWithFileLinks>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Code Insights */}
              {insights.codeInsights && insights.codeInsights.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <GitBranch size={14} className="text-accent3" />
                    <h4 className="font-sans text-base font-bold text-heading">Codebase Analysis</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {insights.codeInsights.map((obs: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-accent3 font-mono text-[10px] mt-0.5 shrink-0">{'</>'}</span>
                        <MarkdownWithFileLinks filePaths={filePaths} onFileClick={handleFileClick} githubRepo={project?.github_repo} gitlabRepos={gitlabRepos} onRepoClick={handleRepoClick} tasks={goals} onTaskClick={(id) => { const g = goals.find((g) => g.id === id); if (g) { setEditAutoGuidance(false); setEditGoal(g); } }}>{obs}</MarkdownWithFileLinks>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Standup Results */}
      {(standup || standupLoading || standupError) && (
        <div className="border border-border bg-surface p-6 mb-8">
          <div className="flex items-center gap-2 mb-4">
            <ClipboardList size={14} className="text-accent" />
            <h3 className="font-sans text-sm font-bold text-heading">2-Week Standup</h3>
          </div>

          {standupLoading && (
            <div className="flex items-center gap-3 py-8 justify-center">
              <Loader2 size={18} className="animate-spin text-accent" />
              <span className="text-sm text-muted">Analyzing 14 days of activity…</span>
            </div>
          )}

          {standupError && (
            <div className="flex items-center gap-3 p-4 border border-red-300/30 bg-red-500/5 rounded">
              <X size={16} className="text-red-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-heading mb-0.5">Standup generation failed</p>
                <p className="text-[11px] text-muted">{standupError}</p>
              </div>
            </div>
          )}

          {standup && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-mono text-muted">
                  {standup.period.from} → {standup.period.to}
                </span>
                {standup.commitSummary.map((r) => (
                  <span
                    key={r.repo}
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-border/60 text-muted"
                  >
                    <GitBranch size={9} />
                    {r.repo.split('/').pop()} · {r.count}
                  </span>
                ))}
                {standup.provider && (
                  <span className="ml-auto text-[10px] text-muted font-mono">{standup.provider}</span>
                )}
              </div>

              {standup.highlights && (
                <div className="px-4 py-3 rounded bg-accent/8 border border-accent/15">
                  <p className="text-xs text-heading leading-relaxed">{standup.highlights}</p>
                </div>
              )}

              {standup.accomplished.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={13} className="text-green-500" />
                    <h4 className="font-sans text-base font-bold text-heading">Accomplished</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {standup.accomplished.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {standup.inProgress.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={13} className="text-accent" />
                    <h4 className="font-sans text-base font-bold text-heading">In Progress</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {standup.inProgress.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-accent shrink-0 mt-0.5">→</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {standup.blockers.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <X size={13} className="text-red-400" />
                    <h4 className="font-sans text-base font-bold text-heading">Blockers / Risks</h4>
                  </div>
                  <ul className="space-y-1.5 pl-5">
                    {standup.blockers.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted leading-relaxed">
                        <span className="text-red-400 shrink-0 mt-0.5">⚠</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Timeline */}
      <div className="border border-border bg-surface p-6 mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={14} className="text-accent2" />
          <h3 className="font-sans text-sm font-bold text-heading">Timeline</h3>
        </div>
        <Timeline
          goals={goals}
          members={[
            { user_id: user?.id ?? '', display_name: user?.user_metadata?.user_name ?? user?.email ?? 'You' },
            ...members.map((m) => ({ user_id: m.user_id, display_name: m.profile?.display_name ?? null })),
          ]}
        />
      </div>

      {/* Recent Activity */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={14} className="text-accent" />
          <h3 className="font-sans text-sm font-bold text-heading">Recent Activity</h3>
        </div>
        <CommitActivityCharts projectId={project.id} onHasData={setHasCommitData} />
        <ActivityFeed
          events={events.slice(0, 10)}
          loading={eventsLoading}
          emptyMessage={hasCommitData ? undefined : "No activity yet. Connect a GitHub repo to start."}
        />
      </div>

      {/* Team Members */}
      <div className="border border-border bg-surface p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={14} className="text-accent2" />
            <h3 className="font-sans text-sm font-bold text-heading">Team Members</h3>
            <span className="text-[10px] text-muted font-mono bg-surface2 px-1.5 py-0.5 rounded">{members.length + 1}</span>
          </div>
          <button type="button" onClick={() => setActiveTab('settings')}
            className="text-[10px] text-accent hover:underline">
            Manage →
          </button>
        </div>
        <div className="space-y-px border border-border bg-border">
          {/* Owner row — current user */}
          <div className="flex items-center gap-3 bg-surface px-4 py-2.5">
            {user?.user_metadata?.avatar_url
              ? <img src={user.user_metadata.avatar_url} alt="" className="w-7 h-7 rounded-full" />
              : <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center"><span className="text-[10px] text-accent font-bold">You</span></div>
            }
            <div className="flex-1 min-w-0">
              <div className="text-xs text-heading font-medium truncate">{user?.user_metadata?.user_name ?? user?.email ?? 'You'}</div>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 border border-accent3/30 text-accent3 rounded uppercase font-mono">Owner</span>
          </div>
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 bg-surface px-4 py-2.5 group">
              {m.profile?.avatar_url
                ? <img src={m.profile.avatar_url} alt="" className="w-7 h-7 rounded-full" />
                : <div className="w-7 h-7 rounded-full bg-accent2/20 flex items-center justify-center">
                    <span className="text-[10px] text-accent2 font-bold uppercase">{(m.profile?.display_name ?? '?')[0]}</span>
                  </div>
              }
              <div className="flex-1 min-w-0">
                <div className="text-xs text-heading font-medium truncate">{m.profile?.display_name ?? m.user_id}</div>
              </div>
              <span className={`text-[9px] px-1.5 py-0.5 border rounded uppercase font-mono ${
                m.role === 'owner' ? 'border-accent3/30 text-accent3' : 'border-border text-muted'
              }`}>{m.role}</span>
              {m.role !== 'owner' && (
                <button
                  type="button"
                  title="Promote to owner"
                  onClick={() => handlePromoteMember(m.user_id)}
                  className="opacity-0 group-hover:opacity-100 text-[9px] px-2 py-0.5 border border-accent3/30 text-accent3 rounded hover:bg-accent3/10 transition-all"
                >
                  Make Owner
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default React.memo(OverviewTab);
