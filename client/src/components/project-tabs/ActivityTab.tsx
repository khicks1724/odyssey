import React from 'react';
import {
  Sparkles,
  CheckCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
} from 'lucide-react';
import ActivityFeed from '../ActivityFeed';
import MarkdownWithFileLinks from '../MarkdownWithFileLinks';
import CommitActivityCharts from '../CommitActivityCharts';
import ProgressRing from '../ProgressRing';
import type { Goal, OdysseyEvent } from '../../types';

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null };
}

export interface ActivityTabProps {
  project: { id: string };
  goals: Goal[];
  events: OdysseyEvent[];
  eventsLoading: boolean;
  hasCommitData: boolean;
  setHasCommitData: (v: boolean) => void;
  members: MemberRow[];
  user: { id?: string; user_metadata?: { user_name?: string; avatar_url?: string; email?: string }; email?: string } | null;
  taskGuidance: Record<string, { loading: boolean; text: string | null; provider?: string }>;
  guidanceVisible: Record<string, boolean>;
  setGuidanceVisible: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  handleTaskGuidance: (g: { id: string; title: string; status: string; progress: number; category: string | null; loe: string | null }) => void;
  getAssignee: (userId: string | null | undefined) => { user_id?: string; display_name: string | null; avatar_url: string | null } | null;
}

function ActivityTab({
  project,
  goals,
  events,
  eventsLoading,
  hasCommitData,
  setHasCommitData,
  members,
  user,
  taskGuidance,
  guidanceVisible,
  setGuidanceVisible,
  handleTaskGuidance,
  getAssignee,
}: ActivityTabProps) {
  return (
    <div className="border border-border bg-surface p-6 space-y-8">
      <CommitActivityCharts projectId={project.id} onHasData={setHasCommitData} />

      {/* ── Recent Goal Progress ────────────────────────────────── */}
      {(() => {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const recentGoals = goals
          .filter((g) => g.updated_at && g.updated_at > thirtyDaysAgo && g.status !== 'not_started')
          .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
          .slice(0, 8);

        if (recentGoals.length === 0) return null;

        const statusLabel: Record<string, string> = {
          in_progress: 'In Progress',
          in_review: 'In Review',
          complete: 'Complete',
          at_risk: 'At Risk',
        };
        const statusColor: Record<string, string> = {
          not_started: 'text-[#D94F4F]',
          in_progress:  'text-[#D97E2A]',
          in_review:    'text-[#facc15]',
          complete:     'text-[#6DBE7D]',
          at_risk:      'text-[#D94F4F]',
        };

        return (
          <section>
            <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted font-semibold mb-3">
              Recent Task Progress
            </h4>
            <div className="space-y-3">
              {recentGoals.map((g) => {
                const updatedBy = getAssignee(g.updated_by);
                const assignedTo = getAssignee(g.assigned_to);
                const actor = updatedBy ?? assignedTo;

                const relatedEvent = events.find(
                  (e) => e.event_type === 'goal_progress_updated' &&
                    (e.metadata as Record<string, unknown> | null)?.goal_id === g.id
                );
                const relatedMeta = relatedEvent?.metadata as Record<string, unknown> | null;
                const evidence = relatedMeta?.evidence as string | undefined;
                const completedBy = relatedMeta?.completed_by as string | undefined;

                const daysAgo = Math.floor(
                  (Date.now() - new Date(g.updated_at).getTime()) / (1000 * 60 * 60 * 24)
                );
                const timeStr = daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`;
                const guidance = taskGuidance[g.id];
                const hasGuidance = !!guidance?.text;
                const isVisible = !!guidanceVisible[g.id];

                return (
                  <div key={g.id} className="rounded border border-border/50 bg-surface2/30 hover:bg-surface2 transition-colors group">
                    <div className="flex items-start gap-3 px-3 py-3">
                      {/* Progress ring */}
                      <div className="relative shrink-0">
                        <ProgressRing progress={g.progress} size={44} />
                        {g.status === 'complete' && (
                          <CheckCircle size={10} className="absolute -top-0.5 -right-0.5 text-accent3" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Title row */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm text-heading font-semibold leading-snug">{g.title}</span>
                          <div className="flex flex-col items-end shrink-0 gap-0.5">
                            <button
                              type="button"
                              title={hasGuidance ? 'Regenerate guidance' : 'Get AI guidance'}
                              onClick={() => handleTaskGuidance(g)}
                              disabled={guidance?.loading}
                              className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-accent/10 transition-all disabled:opacity-40 ${hasGuidance ? 'text-accent' : 'text-muted hover:text-accent'}`}
                            >
                              {hasGuidance ? <RefreshCw size={10} /> : <Sparkles size={11} />}
                              {hasGuidance && <span className="font-mono">Regenerate</span>}
                            </button>
                            <span className="text-[10px] text-muted font-mono">{timeStr}</span>
                          </div>
                        </div>

                        {/* Badges row */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className={`text-[10px] font-semibold ${statusColor[g.status] ?? 'text-muted'}`}>
                            {statusLabel[g.status] ?? g.status}
                          </span>
                          <span className="text-[10px] text-muted font-mono">{g.progress}%</span>
                          {g.category && (
                            <span className="text-[9px] px-1.5 py-0.5 border border-border rounded text-muted font-mono uppercase">{g.category}</span>
                          )}
                          {g.loe && (
                            <span className="text-[9px] px-1.5 py-0.5 border border-accent2/30 rounded text-accent2 font-mono uppercase">{g.loe}</span>
                          )}
                          {actor && (
                            <span className="text-[10px] text-muted">
                              {updatedBy ? `updated by ${updatedBy.display_name}` : assignedTo ? `assigned to ${assignedTo.display_name}` : ''}
                            </span>
                          )}
                          {completedBy && (
                            <span className="text-[10px] text-muted">work by {completedBy}</span>
                          )}
                        </div>

                        {evidence && (
                          <p className="text-[11px] text-muted mt-1 line-clamp-2 italic">{evidence}</p>
                        )}
                      </div>
                    </div>

                    {/* AI Guidance panel — collapsible, text persists */}
                    {(guidance?.loading || hasGuidance) && (
                      <div className="border-t border-border/50">
                        {/* Panel header with collapse toggle */}
                        <button
                          type="button"
                          onClick={() => !guidance?.loading && setGuidanceVisible((prev) => ({ ...prev, [g.id]: !isVisible }))}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface2/50 transition-colors"
                        >
                          {guidance?.loading
                            ? <Loader2 size={11} className="text-accent shrink-0 animate-spin" />
                            : <Sparkles size={11} className="text-accent shrink-0" />
                          }
                          <span className="text-[10px] text-accent font-mono tracking-wide flex-1 text-left">
                            {guidance?.loading ? 'Analyzing task…' : 'AI Guidance'}
                          </span>
                          {!guidance?.loading && (
                            isVisible
                              ? <ChevronUp size={11} className="text-muted" />
                              : <ChevronDown size={11} className="text-muted" />
                          )}
                        </button>

                        {/* Collapsible content — hidden while loading to avoid duplicate status */}
                        {isVisible && !guidance?.loading && (
                          <div className="px-3 pb-2.5">
                            <div className="text-[11px] text-muted leading-relaxed min-w-0">
                              <MarkdownWithFileLinks
                                block
                                filePaths={new Map()}
                                onFileClick={() => {}}
                              >
                                {guidance?.text ?? ''}
                              </MarkdownWithFileLinks>
                            </div>
                            {guidance?.provider && (
                              <div className="mt-1.5 text-[9px] text-muted/50 font-mono text-right">{guidance.provider}</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* ── Event Feed ───────────────────────────────────────────── */}
      <section>
        <h4 className="text-[10px] tracking-[0.2em] uppercase text-muted font-semibold mb-3">
          All Activity
        </h4>
        <ActivityFeed
          events={events}
          loading={eventsLoading}
          emptyMessage={events.length === 0 ? "No activity yet. Task creation, status changes, and repo commits will appear here." : undefined}
        />
      </section>
    </div>
  );
}

export default React.memo(ActivityTab);
