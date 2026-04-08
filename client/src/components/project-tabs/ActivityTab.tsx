import React from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FolderKanban,
  GitCommitHorizontal,
  Layers3,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from 'lucide-react';
import ActivityFeed from '../ActivityFeed';
import CommitActivityCharts from '../CommitActivityCharts';
import MarkdownWithFileLinks from '../MarkdownWithFileLinks';
import ProgressRing from '../ProgressRing';
import { supabase } from '../../lib/supabase';
import type { Goal, OdysseyEvent } from '../../types';

interface MemberRow {
  user_id: string;
  role: string;
  joined_at: string;
  profile?: { display_name: string | null; avatar_url: string | null; email?: string | null; username?: string | null };
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

type StatusTone = 'neutral' | 'warning' | 'positive' | 'danger';

type StatusStat = {
  id: string;
  label: string;
  count: number;
  tone: StatusTone;
};

type GroupStat = {
  label: string;
  total: number;
  completed: number;
  avgProgress: number;
  recentUpdates: number;
};

type ContributorStat = {
  id: string;
  name: string;
  role: string;
  eventCount: number;
  taskTouches: number;
  activeTasks: number;
  completedTasks: number;
  lastActiveAt: string | null;
};

type ActivityDay = {
  date: string;
  count: number;
  taskUpdates: number;
  eventCount: number;
};

type ResolvedPerson = {
  id: string;
  name: string;
  role: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  not_started: { label: 'Not Started', tone: 'neutral' },
  in_progress: { label: 'In Progress', tone: 'warning' },
  in_review: { label: 'In Review', tone: 'warning' },
  complete: { label: 'Complete', tone: 'positive' },
  at_risk: { label: 'At Risk', tone: 'danger' },
  missed: { label: 'Missed', tone: 'danger' },
  active: { label: 'Active', tone: 'warning' },
};

const EVENT_LABELS: Record<string, string> = {
  commit: 'Commits',
  file_upload: 'Files',
  goal_progress_updated: 'Task updates',
  time_logged: 'Time logs',
  comment_added: 'Comments',
  message: 'Messages',
  meeting: 'Meetings',
  note: 'Notes',
  file_edit: 'File edits',
};

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  manual: 'Manual',
  teams: 'Teams',
  onedrive: 'OneDrive',
  onenote: 'OneNote',
  ai: 'AI',
  local: 'Local',
};

function formatRelativeDay(date: string) {
  const parsed = new Date(date);
  const diffDays = Math.floor((Date.now() - parsed.getTime()) / DAY_MS);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  return `${diffDays}d ago`;
}

function isoDay(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function emailLocalPart(email?: string | null): string | null {
  if (!email) return null;
  const [localPart] = email.split('@');
  return localPart?.trim() || null;
}

function isResolvedName(name: string | null | undefined, userId: string) {
  const trimmed = name?.trim();
  return !!trimmed && trimmed !== userId;
}

function getCurrentUserDisplayName(user: ActivityTabProps['user']) {
  return (
    user?.user_metadata?.user_name?.trim()
    || emailLocalPart(user?.user_metadata?.email)
    || emailLocalPart(user?.email)
    || user?.email
    || 'You'
  );
}

function getMemberDisplayName(member: MemberRow) {
  return (
    member.profile?.display_name?.trim()
    || member.profile?.username?.trim()
    || emailLocalPart(member.profile?.email)
    || member.user_id
  );
}

function MetricCard({
  label,
  value,
  meta,
  icon: Icon,
}: {
  label: string;
  value: string;
  meta: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface2/40 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-heading">{value}</p>
        </div>
        <div className="rounded-full border border-border/80 bg-surface px-2.5 py-2">
          <Icon size={14} className="text-accent" />
        </div>
      </div>
      <p className="mt-3 text-xs text-muted leading-5">{meta}</p>
    </div>
  );
}

function DistributionCard({
  title,
  subtitle,
  items,
  tone = 'progress',
}: {
  title: string;
  subtitle: string;
  items: GroupStat[];
  tone?: 'progress' | 'volume';
}) {
  const maxTotal = Math.max(...items.map((item) => item.total), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-heading">{title}</h3>
          <p className="text-xs text-muted mt-1">{subtitle}</p>
        </div>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const width = `${Math.max((item.total / maxTotal) * 100, 8)}%`;
          const progressWidth = `${Math.max(item.avgProgress, item.completed > 0 ? 6 : 0)}%`;
          return (
            <div key={item.label} className="rounded-xl border border-border/70 bg-surface2/35 px-3 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-heading truncate">{item.label}</p>
                  <p className="text-[11px] text-muted mt-1">
                    {item.total} tasks, {item.completed} complete, {item.recentUpdates} touched in the last 14 days
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-heading">{item.avgProgress}%</p>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted">avg progress</p>
                </div>
              </div>

              <div className="mt-3 h-2 rounded-full bg-border/70 overflow-hidden">
                <div
                  className={tone === 'volume' ? 'h-full rounded-full bg-accent2/45' : 'h-full rounded-full bg-accent2/35'}
                  style={{ width }}
                />
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-border/50 overflow-hidden">
                <div className="h-full rounded-full bg-accent" style={{ width: progressWidth }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatusOverview({
  items,
  total,
}: {
  items: StatusStat[];
  total: number;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-sm font-semibold text-heading">Task Status Mix</h3>
          <p className="text-xs text-muted mt-1">Where work currently sits across the project.</p>
        </div>
        <span className="text-[11px] font-mono text-muted">{total} total</span>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const width = total > 0 ? `${(item.count / total) * 100}%` : '0%';
          const toneClass =
            item.tone === 'positive'
              ? 'bg-accent3'
              : item.tone === 'danger'
                ? 'bg-danger'
                : item.tone === 'warning'
                  ? 'bg-accent2'
                  : 'bg-muted/55';
          return (
            <div key={item.id}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-heading">{item.label}</span>
                <span className="font-mono text-muted">{item.count}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-border/60 overflow-hidden">
                <div className={`h-full rounded-full ${toneClass}`} style={{ width }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RankedStats({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: Array<{ label: string; value: number }>;
}) {
  const maxValue = Math.max(...items.map((item) => item.value), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-heading">{title}</h3>
        <p className="text-xs text-muted mt-1">{subtitle}</p>
      </div>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-heading">{item.label}</span>
              <span className="font-mono text-muted">{item.value}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-border/60 overflow-hidden">
              <div className="h-full rounded-full bg-accent2/70" style={{ width: `${(item.value / maxValue) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CadenceChart({ days }: { days: ActivityDay[] }) {
  const maxCount = Math.max(...days.map((day) => day.count), 1);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-heading">Activity Cadence</h3>
        <p className="text-xs text-muted mt-1">Last 14 days of events plus task updates.</p>
      </div>

      <div className="flex items-end gap-2 h-36">
        {days.map((day) => {
          const height = day.count > 0 ? `${Math.max((day.count / maxCount) * 100, 8)}%` : '6%';
          const label = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 1);
          return (
            <div key={day.date} className="flex-1 min-w-0 flex flex-col items-center gap-2">
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t-md bg-accent/85 transition-opacity"
                  style={{ height }}
                  title={`${day.date}: ${day.count} total signals, ${day.eventCount} events, ${day.taskUpdates} task updates`}
                />
              </div>
              <div className="text-center">
                <p className="text-[10px] font-mono text-heading">{day.count}</p>
                <p className="text-[10px] text-muted">{label}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ContributorBoard({ contributors }: { contributors: ContributorStat[] }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-heading">Contributor Snapshot</h3>
        <p className="text-xs text-muted mt-1">Recent task movement and logged activity by project member.</p>
      </div>

      <div className="space-y-3">
        {contributors.map((person) => (
          <div key={person.id} className="rounded-xl border border-border/70 bg-surface2/35 px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-heading truncate">{person.name}</p>
                <p className="text-[11px] text-muted mt-1">
                  {person.role} · {person.lastActiveAt ? `active ${formatRelativeDay(person.lastActiveAt)}` : 'no recent activity'}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-semibold text-heading">{person.taskTouches + person.eventCount}</p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted">signals</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted">
              <div className="rounded-lg border border-border/60 bg-surface px-2.5 py-2">
                <span className="text-heading font-semibold">{person.taskTouches}</span> tasks touched
              </div>
              <div className="rounded-lg border border-border/60 bg-surface px-2.5 py-2">
                <span className="text-heading font-semibold">{person.eventCount}</span> logged events
              </div>
              <div className="rounded-lg border border-border/60 bg-surface px-2.5 py-2">
                <span className="text-heading font-semibold">{person.activeTasks}</span> active tasks
              </div>
              <div className="rounded-lg border border-border/60 bg-surface px-2.5 py-2">
                <span className="text-heading font-semibold">{person.completedTasks}</span> completed
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
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
  const missingContributorIds = React.useMemo(() => {
    const knownNames = new Map<string, string>();

    if (user?.id) {
      knownNames.set(user.id, getCurrentUserDisplayName(user));
    }

    for (const member of members) {
      knownNames.set(member.user_id, getMemberDisplayName(member));
    }

    const referencedIds = new Set<string>();
    const collect = (value: string | null | undefined) => {
      if (value) referencedIds.add(value);
    };

    for (const goal of goals) {
      collect(goal.assigned_to);
      collect(goal.updated_by);
      collect(goal.created_by);
      for (const assigneeId of goal.assignees ?? []) collect(assigneeId);
    }

    for (const event of events) collect(event.actor_id);

    return Array.from(referencedIds).filter((userId) => !isResolvedName(knownNames.get(userId), userId));
  }, [events, goals, members, user]);

  const [supplementalNames, setSupplementalNames] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;

    const loadMissingProfiles = async () => {
      if (missingContributorIds.length === 0) {
        setSupplementalNames((current) => (Object.keys(current).length > 0 ? {} : current));
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, username, email')
        .in('id', missingContributorIds);

      if (cancelled || error) return;

      const nextNames: Record<string, string> = {};
      for (const profile of data ?? []) {
        const resolvedName =
          profile.display_name?.trim()
          || profile.username?.trim()
          || emailLocalPart(profile.email)
          || profile.id;
        nextNames[profile.id] = resolvedName;
      }

      setSupplementalNames(nextNames);
    };

    void loadMissingProfiles();

    return () => {
      cancelled = true;
    };
  }, [missingContributorIds]);

  const activityModel = React.useMemo(() => {
    const now = Date.now();
    const cutoff14 = now - 14 * DAY_MS;
    const cutoff30 = now - 30 * DAY_MS;
    const todayIso = isoDay(new Date());

    const memberNameMap = new Map<string, { name: string; role: string }>();
    if (user?.id) {
      memberNameMap.set(user.id, {
        name: getCurrentUserDisplayName(user),
        role: 'Current user',
      });
    }

    for (const member of members) {
      memberNameMap.set(member.user_id, {
        name: getMemberDisplayName(member),
        role: member.role,
      });
    }

    for (const [userId, name] of Object.entries(supplementalNames)) {
      if (!isResolvedName(name, userId)) continue;
      const existing = memberNameMap.get(userId);
      memberNameMap.set(userId, {
        name,
        role: existing?.role ?? 'Contributor',
      });
    }

    const resolvePerson = (userId: string | null | undefined): ResolvedPerson | null => {
      if (!userId) return null;
      const assignee = getAssignee(userId);
      const assigneeName = assignee?.display_name?.trim() || null;
      if (isResolvedName(assigneeName, userId)) {
        return { id: userId, name: assigneeName as string, role: memberNameMap.get(userId)?.role ?? 'Member' };
      }
      const fromMember = memberNameMap.get(userId);
      if (fromMember && isResolvedName(fromMember.name, userId)) {
        return { id: userId, name: fromMember.name, role: fromMember.role };
      }
      if (assigneeName) {
        return { id: userId, name: assigneeName, role: memberNameMap.get(userId)?.role ?? 'Member' };
      }
      if (fromMember) return { id: userId, name: fromMember.name, role: fromMember.role };
      return { id: userId, name: userId, role: 'Member' };
    };

    const openGoals = goals.filter((goal) => goal.status !== 'complete');
    const completedGoals = goals.filter((goal) => goal.status === 'complete');
    const recentGoalUpdates = goals.filter((goal) => new Date(goal.updated_at).getTime() >= cutoff14);
    const recentEvents = events.filter((event) => new Date(event.occurred_at).getTime() >= cutoff14);
    const monthlyEvents = events.filter((event) => new Date(event.occurred_at).getTime() >= cutoff30);
    const overdueOpen = openGoals.filter((goal) => goal.deadline && goal.deadline < todayIso);
    const avgProgress = goals.length > 0
      ? Math.round(goals.reduce((sum, goal) => sum + (Number.isFinite(goal.progress) ? goal.progress : 0), 0) / goals.length)
      : 0;

    const statusOrder = ['not_started', 'in_progress', 'in_review', 'at_risk', 'missed', 'complete'];
    const statusCounts = new Map<string, number>();
    for (const goal of goals) {
      statusCounts.set(goal.status, (statusCounts.get(goal.status) ?? 0) + 1);
    }
    const statusStats: StatusStat[] = statusOrder
      .filter((status) => (statusCounts.get(status) ?? 0) > 0)
      .map((status) => ({
        id: status,
        label: STATUS_META[status]?.label ?? status,
        count: statusCounts.get(status) ?? 0,
        tone: STATUS_META[status]?.tone ?? 'neutral',
      }));

    const buildGroupStats = (selector: (goal: Goal) => string | null | undefined, fallbackLabel: string) => {
      const grouped = new Map<string, GroupStat>();

      for (const goal of goals) {
        const key = selector(goal)?.trim() || fallbackLabel;
        const existing = grouped.get(key) ?? { label: key, total: 0, completed: 0, avgProgress: 0, recentUpdates: 0 };
        existing.total += 1;
        existing.completed += goal.status === 'complete' ? 1 : 0;
        existing.avgProgress += Number.isFinite(goal.progress) ? goal.progress : 0;
        existing.recentUpdates += new Date(goal.updated_at).getTime() >= cutoff14 ? 1 : 0;
        grouped.set(key, existing);
      }

      return Array.from(grouped.values())
        .map((item) => ({
          ...item,
          avgProgress: Math.round(item.avgProgress / Math.max(item.total, 1)),
        }))
        .sort((a, b) => {
          if (b.total !== a.total) return b.total - a.total;
          return b.avgProgress - a.avgProgress;
        })
        .slice(0, 6);
    };

    const categoryStats = buildGroupStats((goal) => goal.category, 'Uncategorized');
    const loeStats = buildGroupStats((goal) => goal.loe, 'Unassigned LOE');

    const sourceCounts = new Map<string, number>();
    const eventTypeCounts = new Map<string, number>();
    for (const event of monthlyEvents) {
      sourceCounts.set(event.source, (sourceCounts.get(event.source) ?? 0) + 1);
      eventTypeCounts.set(event.event_type, (eventTypeCounts.get(event.event_type) ?? 0) + 1);
    }

    const sourceStats = Array.from(sourceCounts.entries())
      .map(([source, value]) => ({ label: SOURCE_LABELS[source] ?? source, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const eventTypeStats = Array.from(eventTypeCounts.entries())
      .map(([eventType, value]) => ({ label: EVENT_LABELS[eventType] ?? eventType.replaceAll('_', ' '), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const contributorMap = new Map<string, ContributorStat>();
    const ensureContributor = (userId: string | null | undefined) => {
      const person = resolvePerson(userId);
      if (!person) return null;
      if (!contributorMap.has(person.id)) {
        contributorMap.set(person.id, {
          id: person.id,
          name: person.name,
          role: person.role,
          eventCount: 0,
          taskTouches: 0,
          activeTasks: 0,
          completedTasks: 0,
          lastActiveAt: null,
        });
      }
      return contributorMap.get(person.id)!;
    };

    for (const goal of goals) {
      const taskOwners = new Set<string>();
      if (goal.assigned_to) taskOwners.add(goal.assigned_to);
      for (const assigneeId of goal.assignees ?? []) taskOwners.add(assigneeId);

      for (const ownerId of taskOwners) {
        const contributor = ensureContributor(ownerId);
        if (!contributor) continue;
        if (goal.status === 'complete') contributor.completedTasks += 1;
        else contributor.activeTasks += 1;
      }

      if (new Date(goal.updated_at).getTime() >= cutoff30) {
        const contributor = ensureContributor(goal.updated_by);
        if (contributor) {
          contributor.taskTouches += 1;
          contributor.lastActiveAt = contributor.lastActiveAt && contributor.lastActiveAt > goal.updated_at
            ? contributor.lastActiveAt
            : goal.updated_at;
        }
      }
    }

    for (const event of monthlyEvents) {
      const contributor = ensureContributor(event.actor_id);
      if (!contributor) continue;
      contributor.eventCount += 1;
      contributor.lastActiveAt = contributor.lastActiveAt && contributor.lastActiveAt > event.occurred_at
        ? contributor.lastActiveAt
        : event.occurred_at;
    }

    const contributors = Array.from(contributorMap.values())
      .filter((person) => person.eventCount > 0 || person.taskTouches > 0 || person.activeTasks > 0 || person.completedTasks > 0)
      .sort((a, b) => {
        const scoreA = a.taskTouches * 3 + a.eventCount * 2 + a.activeTasks + a.completedTasks;
        const scoreB = b.taskTouches * 3 + b.eventCount * 2 + b.activeTasks + b.completedTasks;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 6);

    const cadenceStart = new Date();
    cadenceStart.setHours(0, 0, 0, 0);
    cadenceStart.setDate(cadenceStart.getDate() - 13);
    const cadenceMap = new Map<string, ActivityDay>();

    for (let index = 0; index < 14; index += 1) {
      const date = addDays(cadenceStart, index);
      const key = isoDay(date);
      cadenceMap.set(key, { date: key, count: 0, taskUpdates: 0, eventCount: 0 });
    }

    for (const event of events) {
      const key = event.occurred_at.slice(0, 10);
      const entry = cadenceMap.get(key);
      if (!entry) continue;
      entry.count += 1;
      entry.eventCount += 1;
    }
    for (const goal of goals) {
      const key = goal.updated_at.slice(0, 10);
      const entry = cadenceMap.get(key);
      if (!entry) continue;
      entry.count += 1;
      entry.taskUpdates += 1;
    }

    const cadence = Array.from(cadenceMap.values());
    const activeDays = cadence.filter((day) => day.count > 0).length;

    return {
      avgProgress,
      openGoals,
      completedGoals,
      recentGoalUpdates,
      recentEvents,
      overdueOpen,
      statusStats,
      categoryStats,
      loeStats,
      contributors,
      cadence,
      activeDays,
      sourceStats,
      eventTypeStats,
    };
  }, [events, getAssignee, goals, members, supplementalNames, user]);

  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const recentGoals = React.useMemo(
    () =>
      goals
        .filter((goal) => goal.updated_at && goal.updated_at > thirtyDaysAgo && goal.status !== 'not_started')
        .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
        .slice(0, 8),
    [goals, thirtyDaysAgo],
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Open Tasks"
          value={String(activityModel.openGoals.length)}
          meta={`${activityModel.overdueOpen.length} overdue and ${activityModel.recentGoalUpdates.length} touched in the last 14 days.`}
          icon={FolderKanban}
        />
        <MetricCard
          label="Average Progress"
          value={`${activityModel.avgProgress}%`}
          meta={`${activityModel.completedGoals.length} completed tasks out of ${goals.length} total.`}
          icon={BarChart3}
        />
        <MetricCard
          label="Active Contributors"
          value={String(activityModel.contributors.length)}
          meta={`${activityModel.recentEvents.length} logged events across ${activityModel.activeDays} active days in the last 14 days.`}
          icon={Users}
        />
        <MetricCard
          label="Repo Momentum"
          value={hasCommitData ? 'Live' : 'Quiet'}
          meta={hasCommitData ? 'Combined GitHub and GitLab repo activity is present for this project.' : 'No commit history is currently linked into this project view.'}
          icon={GitCommitHorizontal}
        />
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-heading">Repository Activity</h3>
            <p className="text-xs text-muted mt-1">Combined commit heatmap and commit velocity across all linked project repos.</p>
          </div>
          <span className="text-[11px] font-mono text-muted">{hasCommitData ? 'repo data connected' : 'waiting for repo data'}</span>
        </div>
        <CommitActivityCharts projectId={project.id} onHasData={setHasCommitData} />
        {!hasCommitData && (
          <div className="mt-3 rounded-xl border border-border/70 bg-surface2/35 px-4 py-3 text-xs text-muted">
            Link GitHub or GitLab repositories to surface combined commit heatmaps and daily commit velocity here.
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <CadenceChart days={activityModel.cadence} />
        <StatusOverview items={activityModel.statusStats} total={goals.length} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DistributionCard
          title="Progress by Category"
          subtitle="Category buckets ranked by task volume and current completion depth."
          items={activityModel.categoryStats}
        />
        <DistributionCard
          title="Progress by LOE"
          subtitle="Level-of-effort buckets showing where work is concentrated and how fast it is moving."
          items={activityModel.loeStats}
          tone="volume"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ContributorBoard contributors={activityModel.contributors} />
        <div className="grid gap-4">
          {activityModel.eventTypeStats.length > 0 && (
            <RankedStats
              title="Recent Activity Types"
              subtitle="What kinds of project signals have been most frequent in the last 30 days."
              items={activityModel.eventTypeStats}
            />
          )}
          {activityModel.sourceStats.length > 0 && (
            <RankedStats
              title="Activity Sources"
              subtitle="Where recent activity is coming from across integrations and manual updates."
              items={activityModel.sourceStats}
            />
          )}
        </div>
      </section>

      {recentGoals.length > 0 && (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-heading">Recent Task Momentum</h3>
            <p className="text-xs text-muted mt-1">Most recently updated tasks, including ownership context and optional AI guidance.</p>
          </div>

          <div className="space-y-3">
            {recentGoals.map((goal) => {
              const updatedBy = getAssignee(goal.updated_by);
              const assignedTo = getAssignee(goal.assigned_to);
              const actor = updatedBy ?? assignedTo;
              const relatedEvent = events.find(
                (event) => event.event_type === 'goal_progress_updated'
                  && (event.metadata as Record<string, unknown> | null)?.goal_id === goal.id,
              );
              const relatedMeta = relatedEvent?.metadata as Record<string, unknown> | null;
              const evidence = relatedMeta?.evidence as string | undefined;
              const completedBy = relatedMeta?.completed_by as string | undefined;
              const guidance = taskGuidance[goal.id];
              const hasGuidance = !!guidance?.text;
              const isVisible = !!guidanceVisible[goal.id];

              return (
                <div key={goal.id} className="rounded-xl border border-border/70 bg-surface2/30 hover:bg-surface2/45 transition-colors group">
                  <div className="flex items-start gap-3 px-3 py-3">
                    <div className="relative shrink-0">
                      <ProgressRing progress={goal.progress} size={44} />
                      {goal.status === 'complete' && (
                        <CheckCircle2 size={10} className="absolute -top-0.5 -right-0.5 text-accent3" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-sm text-heading font-semibold leading-snug">{goal.title}</span>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            <span className="text-[10px] text-muted font-mono">{goal.progress}%</span>
                            <span className="text-[10px] text-muted">{STATUS_META[goal.status]?.label ?? goal.status}</span>
                            {goal.category && (
                              <span className="text-[9px] px-1.5 py-0.5 border border-border rounded text-muted font-mono uppercase">{goal.category}</span>
                            )}
                            {goal.loe && (
                              <span className="text-[9px] px-1.5 py-0.5 border border-accent2/30 rounded text-accent2 font-mono uppercase">{goal.loe}</span>
                            )}
                            {actor && (
                              <span className="text-[10px] text-muted">
                                {updatedBy ? `updated by ${updatedBy.display_name}` : `assigned to ${assignedTo?.display_name}`}
                              </span>
                            )}
                            {completedBy && <span className="text-[10px] text-muted">work by {completedBy}</span>}
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <button
                            type="button"
                            title={hasGuidance ? 'Regenerate guidance' : 'Get AI guidance'}
                            onClick={() => handleTaskGuidance(goal)}
                            disabled={guidance?.loading}
                            className={`opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-accent/10 transition-all disabled:opacity-40 ${hasGuidance ? 'text-accent' : 'text-muted hover:text-accent'}`}
                          >
                            {hasGuidance ? <RefreshCw size={10} /> : <Sparkles size={11} />}
                            {hasGuidance && <span className="font-mono">Regenerate</span>}
                          </button>
                          <span className="text-[10px] text-muted font-mono">{formatRelativeDay(goal.updated_at)}</span>
                        </div>
                      </div>

                      {evidence && (
                        <p className="text-[11px] text-muted mt-2 line-clamp-2 italic">{evidence}</p>
                      )}
                    </div>
                  </div>

                  {(guidance?.loading || hasGuidance) && (
                    <div className="border-t border-border/50">
                      <button
                        type="button"
                        onClick={() => !guidance?.loading && setGuidanceVisible((prev) => ({ ...prev, [goal.id]: !isVisible }))}
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

                      {isVisible && !guidance?.loading && (
                        <div className="px-3 pb-2.5">
                          <div className="text-[11px] text-muted leading-relaxed min-w-0">
                            <MarkdownWithFileLinks block filePaths={new Map()} onFileClick={() => {}}>
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
      )}

      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-heading">All Activity</h3>
            <p className="text-xs text-muted mt-1">Full project event feed for commits, documents, meetings, messages, and task changes.</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted">
            <Clock3 size={12} />
            {events.length} recent events
          </div>
        </div>

        <ActivityFeed
          events={events}
          loading={eventsLoading}
          emptyMessage={events.length === 0 ? 'No activity yet. Task changes, commits, files, and meetings will appear here.' : undefined}
        />
      </section>
    </div>
  );
}

export default React.memo(ActivityTab);
