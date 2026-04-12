import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarRange, ChartNoAxesColumn, RefreshCw, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useProfile } from '../hooks/useProfile';
import { canViewTokenUsagePage } from '../lib/admin-access';
import { getTimeFormatSettings, useTimeFormat } from '../lib/time-format';

type UsageGranularity = 'day' | 'week' | 'month';
type UsageSourceFilter = 'all' | 'server';
type SortKey = 'displayName' | 'email' | 'totalTokens' | 'promptTokens' | 'completionTokens' | 'requestCount';
type SortDirection = 'asc' | 'desc';

interface UsageBucket {
  periodStart: string;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

interface UsageEntry {
  createdAt: string;
  keySource: 'server' | 'user';
  feature: string;
  routePath: string;
  projectId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UsageUserRow {
  userId: string;
  displayName: string;
  email: string;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  lastUsage: UsageEntry | null;
  usageEntries: UsageEntry[];
  buckets: UsageBucket[];
}

interface TokenUsageResponse {
  granularity: UsageGranularity;
  keySource?: UsageSourceFilter | 'user';
  timeZone?: string;
  range: { start: string; end: string };
  users: UsageUserRow[];
  totals: {
    totalTokens: number;
    promptTokens: number;
    completionTokens: number;
    requestCount: number;
  };
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDateInputValue(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return `${map.get('year')}-${map.get('month')}-${map.get('day')}`;
}

function formatUsageTimestamp(value: string, timeZone: string, hourCycle: 'h12' | 'h23') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

function formatFeatureLabel(value: string) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isoDateDaysAgo(days: number) {
  const { timezone } = getTimeFormatSettings();
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateInputValue(date, timezone);
}

async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? `Bearer ${session.access_token}` : null;
}

export default function TokenUsagePage() {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useProfile();
  const { settings } = useTimeFormat();
  const [granularity, setGranularity] = useState<UsageGranularity>('day');
  const [sourceFilter, setSourceFilter] = useState<UsageSourceFilter>('all');
  const [startDate, setStartDate] = useState(() => isoDateDaysAgo(29));
  const [endDate, setEndDate] = useState(() => formatDateInputValue(new Date(), getTimeFormatSettings().timezone));
  const [sortKey, setSortKey] = useState<SortKey>('totalTokens');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [data, setData] = useState<TokenUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const allowed = canViewTokenUsagePage(
    [user?.email, profile?.email, user?.user_metadata?.email],
    [profile?.display_name, user?.user_metadata?.display_name, user?.user_metadata?.name, user?.user_metadata?.user_name],
  );
  const accessResolved = !authLoading && !profileLoading;

  const loadUsage = async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Please sign in again.');

      const params = new URLSearchParams({
        granularity,
        keySource: sourceFilter,
        start: startDate,
        end: endDate,
        timeZone: settings.timezone,
      });
      const response = await fetch(`/api/admin/token-usage?${params.toString()}`, {
        headers: { Authorization: authHeader },
      });
      const payload = await response.json().catch(() => ({})) as TokenUsageResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error?.trim() || 'Failed to load token usage.');
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load token usage.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    void loadUsage();
  }, [allowed, granularity, settings.timezone, sourceFilter, startDate, endDate]);

  const sortedUsers = useMemo(() => {
    const users = [...(data?.users ?? [])];
    users.sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return sortDirection === 'asc' ? leftValue - rightValue : rightValue - leftValue;
      }

      const comparison = String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' });
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return users;
  }, [data?.users, sortDirection, sortKey]);

  const populatedUsers = useMemo(
    () => sortedUsers.filter((entry) => entry.totalTokens > 0 || entry.requestCount > 0),
    [sortedUsers],
  );

  const selectedUser = useMemo(
    () => sortedUsers.find((entry) => entry.userId === selectedUserId) ?? null,
    [selectedUserId, sortedUsers],
  );

  const selectedUserFeatureSummary = useMemo(() => {
    if (!selectedUser) return [];
    const featureMap = new Map<string, {
      feature: string;
      requestCount: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      lastUsedAt: string;
    }>();

    for (const entry of selectedUser.usageEntries) {
      const key = entry.feature || entry.routePath || 'unknown';
      if (!featureMap.has(key)) {
        featureMap.set(key, {
          feature: key,
          requestCount: 0,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          lastUsedAt: entry.createdAt,
        });
      }
      const current = featureMap.get(key)!;
      current.requestCount += 1;
      current.totalTokens += entry.totalTokens;
      current.promptTokens += entry.promptTokens;
      current.completionTokens += entry.completionTokens;
      if (entry.createdAt > current.lastUsedAt) current.lastUsedAt = entry.createdAt;
    }

    return [...featureMap.values()].sort((left, right) => right.totalTokens - left.totalTokens);
  }, [selectedUser]);

  if (accessResolved && !allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="app-page-width app-page-width--wide mx-auto max-w-7xl p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-accent">Admin</p>
          <h1 className="font-sans text-3xl font-extrabold tracking-tight text-heading">Token Usage</h1>
          <p className="mt-1 text-sm text-muted">
            {sourceFilter === 'server'
              ? 'Server fallback API key token usage across Odyssey users.'
              : 'Token usage across Odyssey users for all logged AI API key activity.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void loadUsage(); }}
          disabled={loading || !allowed}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-4">
        <div className="border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <Users size={13} />
            Users With Usage
          </div>
          <div className="text-2xl font-bold text-heading">{formatNumber(populatedUsers.length)}</div>
        </div>
        <div className="border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <ChartNoAxesColumn size={13} />
            Total Tokens
          </div>
          <div className="text-2xl font-bold text-heading">{formatNumber(data?.totals.totalTokens ?? 0)}</div>
        </div>
        <div className="border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <CalendarRange size={13} />
            Requests
          </div>
          <div className="text-2xl font-bold text-heading">{formatNumber(data?.totals.requestCount ?? 0)}</div>
        </div>
        <div className="border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <ChartNoAxesColumn size={13} />
            Prompt / Completion
          </div>
          <div className="text-sm font-semibold text-heading">
            {formatNumber(data?.totals.promptTokens ?? 0)} / {formatNumber(data?.totals.completionTokens ?? 0)}
          </div>
        </div>
      </div>

      <section className="mb-8 border border-border bg-surface p-4">
        <div className="grid gap-4 lg:grid-cols-7">
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            Granularity
            <select value={granularity} onChange={(event) => setGranularity(event.target.value as UsageGranularity)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            API Key Scope
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as UsageSourceFilter)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none">
              <option value="all">All API Keys</option>
              <option value="server">Server Fallback Only</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            Start
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none" />
          </label>
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            End
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none" />
          </label>
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            Sort By
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none">
              <option value="totalTokens">Total Tokens</option>
              <option value="promptTokens">Prompt Tokens</option>
              <option value="completionTokens">Completion Tokens</option>
              <option value="requestCount">Requests</option>
              <option value="displayName">User Name</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
            Direction
            <select value={sortDirection} onChange={(event) => setSortDirection(event.target.value as SortDirection)} className="border border-border bg-paper px-3 py-2 text-xs text-heading focus:outline-none">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
          <div className="flex flex-col justify-end text-xs text-muted">
            Showing {data?.range.start ?? startDate} through {data?.range.end ?? endDate}
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <section className="overflow-hidden border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr className="border-b border-border bg-surface2 text-left text-[10px] uppercase tracking-[0.16em] text-muted">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">Prompt</th>
                <th className="px-4 py-3 text-right">Completion</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Last Usage</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-sm text-muted">Loading token usage…</td>
                </tr>
              ) : sortedUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-sm text-muted">No users found.</td>
                </tr>
              ) : (
                sortedUsers.map((entry) => (
                  <tr key={entry.userId} className="border-t border-border align-top">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(entry.userId)}
                        className="group inline-flex rounded-sm px-1 py-0.5 -mx-1 -my-0.5 text-left transition-colors hover:bg-accent/10 focus:bg-accent/10 focus:outline-none"
                      >
                        <span className="text-sm font-semibold text-heading transition-colors group-hover:text-accent group-focus:text-accent">
                          {entry.displayName}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted">{entry.email || '—'}</td>
                    <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.requestCount)}</td>
                    <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.promptTokens)}</td>
                    <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.completionTokens)}</td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-heading">{formatNumber(entry.totalTokens)}</td>
                    <td className="px-4 py-3">
                      {entry.lastUsage ? (
                        <div className="min-w-[12rem] border border-border bg-paper px-3 py-2">
                          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted">
                            {formatUsageTimestamp(entry.lastUsage.createdAt, settings.timezone, settings.hourCycle)}
                          </div>
                          <div className="mt-1 text-sm font-semibold text-heading">{formatNumber(entry.lastUsage.totalTokens)} tokens</div>
                          <div className="mt-1 text-[11px] text-muted">
                            {formatFeatureLabel(entry.lastUsage.feature || 'unknown')} · {formatNumber(entry.lastUsage.promptTokens)} in · {formatNumber(entry.lastUsage.completionTokens)} out
                          </div>
                        </div>
                      ) : entry.buckets.length === 0 ? (
                        <span className="text-sm text-muted">No usage in range.</span>
                      ) : (
                        <span className="text-sm text-muted">No recent entry.</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
          onClick={() => setSelectedUserId(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-6xl overflow-hidden border border-border bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface2 px-6 py-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent">User Usage</p>
                <h2 className="mt-1 font-sans text-2xl font-bold text-heading">{selectedUser.displayName}</h2>
                <p className="mt-1 text-sm text-muted">
                  {selectedUser.email || 'No email on profile'} · {data?.range.start ?? startDate} through {data?.range.end ?? endDate} · {sourceFilter === 'server' ? 'Server fallback only' : 'All API keys'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUserId(null)}
                className="inline-flex items-center justify-center border border-border bg-surface px-3 py-2 text-muted transition-colors hover:bg-paper hover:text-heading"
                aria-label="Close usage details"
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[calc(85vh-5rem)] overflow-y-auto p-6">
              <div className="mb-6 grid gap-3 lg:grid-cols-4">
                <div className="border border-border bg-paper p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Total Tokens</div>
                  <div className="mt-2 text-2xl font-bold text-heading">{formatNumber(selectedUser.totalTokens)}</div>
                </div>
                <div className="border border-border bg-paper p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Requests</div>
                  <div className="mt-2 text-2xl font-bold text-heading">{formatNumber(selectedUser.requestCount)}</div>
                </div>
                <div className="border border-border bg-paper p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Prompt / Completion</div>
                  <div className="mt-2 text-sm font-semibold text-heading">
                    {formatNumber(selectedUser.promptTokens)} / {formatNumber(selectedUser.completionTokens)}
                  </div>
                </div>
                <div className="border border-border bg-paper p-4">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted">Latest Request</div>
                  <div className="mt-2 text-sm font-semibold text-heading">
                    {selectedUser.lastUsage ? formatNumber(selectedUser.lastUsage.totalTokens) + ' tokens' : 'No usage'}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {selectedUser.lastUsage ? formatUsageTimestamp(selectedUser.lastUsage.createdAt, settings.timezone, settings.hourCycle) : 'No usage in range'}
                  </div>
                </div>
              </div>

              <section className="mb-6 border border-border bg-paper">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold text-heading">Usage By Feature</h3>
                </div>
                {selectedUserFeatureSummary.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted">No usage in range.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-surface2 text-left text-[10px] uppercase tracking-[0.16em] text-muted">
                          <th className="px-4 py-3">Feature</th>
                          <th className="px-4 py-3">Route</th>
                          <th className="px-4 py-3 text-right">Requests</th>
                          <th className="px-4 py-3 text-right">Prompt</th>
                          <th className="px-4 py-3 text-right">Completion</th>
                          <th className="px-4 py-3 text-right">Total</th>
                          <th className="px-4 py-3">Last Used</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUserFeatureSummary.map((entry) => {
                          const latestEntry = selectedUser.usageEntries.find((usageEntry) => (usageEntry.feature || usageEntry.routePath || 'unknown') === entry.feature);
                          return (
                            <tr key={entry.feature} className="border-t border-border align-top">
                              <td className="px-4 py-3 text-sm font-semibold text-heading">{formatFeatureLabel(entry.feature)}</td>
                              <td className="px-4 py-3 text-sm text-muted">{latestEntry?.routePath || '—'}</td>
                              <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.requestCount)}</td>
                              <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.promptTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.completionTokens)}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-heading">{formatNumber(entry.totalTokens)}</td>
                              <td className="px-4 py-3 text-sm text-muted">{formatUsageTimestamp(entry.lastUsedAt, settings.timezone, settings.hourCycle)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="border border-border bg-paper">
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold text-heading">All Usage Entries</h3>
                </div>
                {selectedUser.usageEntries.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted">No usage in range.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-surface2 text-left text-[10px] uppercase tracking-[0.16em] text-muted">
                          <th className="px-4 py-3">When</th>
                          <th className="px-4 py-3">Feature</th>
                          <th className="px-4 py-3">Key Source</th>
                          <th className="px-4 py-3">Provider / Model</th>
                          <th className="px-4 py-3">Route</th>
                          <th className="px-4 py-3 text-right">Prompt</th>
                          <th className="px-4 py-3 text-right">Completion</th>
                          <th className="px-4 py-3 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUser.usageEntries.map((entry, index) => (
                          <tr key={`${entry.createdAt}-${entry.routePath}-${index}`} className="border-t border-border align-top">
                            <td className="px-4 py-3 text-sm text-muted">{formatUsageTimestamp(entry.createdAt, settings.timezone, settings.hourCycle)}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-heading">{formatFeatureLabel(entry.feature || 'unknown')}</td>
                            <td className="px-4 py-3 text-sm text-muted">{entry.keySource === 'server' ? 'Server fallback' : 'User key'}</td>
                            <td className="px-4 py-3 text-sm text-muted">
                              <div>{entry.provider || 'Unknown provider'}</div>
                              <div className="mt-1 font-mono text-[11px]">{entry.model || 'Unknown model'}</div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted">{entry.routePath || '—'}</td>
                            <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.promptTokens)}</td>
                            <td className="px-4 py-3 text-right text-sm text-heading">{formatNumber(entry.completionTokens)}</td>
                            <td className="px-4 py-3 text-right text-sm font-semibold text-heading">{formatNumber(entry.totalTokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
