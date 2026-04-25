import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CalendarRange, ChartNoAxesColumn, RefreshCw, Users, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useProfile } from '../hooks/useProfile';
import { getTimeFormatSettings, useTimeFormat } from '../lib/time-format';
import { useTheme } from '../lib/theme';

type UsageGranularity = 'day' | 'week' | 'month';
type UsageSourceFilter = 'all' | 'server';
type UsageViewMode = 'table' | 'visuals';
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
  serverFallbackPaused?: boolean;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  lastUsage: UsageEntry | null;
  usageEntries: UsageEntry[];
  buckets: UsageBucket[];
}

interface TokenUsageResponse {
  viewer?: {
    userId: string;
    email: string;
    displayName: string;
    isAdmin: boolean;
  };
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

const SERVER_FALLBACK_CONTROL_ADMIN_EMAIL = 'kyle.hicks@nps.edu';

interface TokenUsageVisualPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  series: string[];
  areaTop: string;
  areaMid: string;
  areaBottom: string;
  cardBorder: string;
  cardGlow: string;
  mutedTrack: string;
  markerFill: string;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
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

function formatProviderLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return 'Unknown provider';
  return trimmed
    .split(/[-_ ]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatModelLabel(value: string) {
  const trimmed = value.trim();
  return trimmed || 'Unknown model';
}

function percentage(value: number, total: number) {
  if (total <= 0) return 0;
  return (value / total) * 100;
}

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const value = Number.parseInt(expanded, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function mixHex(a: string, b: string, bWeight: number) {
  const aRgb = hexToRgb(a);
  const bRgb = hexToRgb(b);
  if (!aRgb || !bRgb) return a;
  const weight = Math.max(0, Math.min(1, bWeight));
  const mixChannel = (first: number, second: number) => Math.round((first * (1 - weight)) + (second * weight));
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(mixChannel(aRgb.r, bRgb.r))}${toHex(mixChannel(aRgb.g, bRgb.g))}${toHex(mixChannel(aRgb.b, bRgb.b))}`;
}

function relativeLuminance(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(a: string, b: string) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b));
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function uniqueColors(colors: string[]) {
  return colors.filter((color, index) => colors.findIndex((candidate) => candidate.toLowerCase() === color.toLowerCase()) === index);
}

function buildVisualPalette(colors: {
  surface: string;
  bg: string;
  border: string;
  heading: string;
  accent: string;
  accent2: string;
  accent3: string;
}): TokenUsageVisualPalette {
  const ranked = [colors.accent, colors.accent2, colors.accent3]
    .map((color) => ({ color, contrast: contrastRatio(color, colors.surface) }))
    .sort((left, right) => right.contrast - left.contrast)
    .map((entry) => entry.color);

  const [primary, secondary, tertiary] = ranked;
  const series = uniqueColors([
    primary,
    secondary,
    tertiary,
    mixHex(primary, secondary, 0.5),
    mixHex(primary, tertiary, 0.5),
    mixHex(secondary, tertiary, 0.5),
    mixHex(primary, colors.heading, 0.35),
    mixHex(secondary, colors.heading, 0.4),
  ]);

  return {
    primary,
    secondary,
    tertiary,
    series,
    areaTop: rgba(primary, 0.34),
    areaMid: rgba(secondary, 0.18),
    areaBottom: rgba(tertiary, 0.08),
    cardBorder: mixHex(primary, colors.border, 0.52),
    cardGlow: rgba(primary, 0.14),
    mutedTrack: mixHex(colors.border, colors.surface, 0.32),
    markerFill: mixHex(colors.bg, colors.surface, 0.45),
  };
}

function buildChartMax(values: number[]) {
  const max = Math.max(...values, 0);
  if (max <= 0) return 1;
  const roughStep = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / roughStep) * roughStep;
}

function VisualStatCard({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: string;
  detail: string;
  accent: string;
}) {
  return (
    <div
      className="border border-border p-4"
      style={{
        background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 14%, var(--color-surface)) 0%, var(--color-surface) 100%)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accent} 20%, transparent)`,
      }}
    >
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="text-2xl font-bold text-heading">{value}</div>
      <div className="mt-2 text-xs text-muted">{detail}</div>
    </div>
  );
}

function UsageTrendChart({
  buckets,
  palette,
}: {
  buckets: UsageBucket[];
  palette: TokenUsageVisualPalette;
}) {
  if (buckets.length === 0) {
    return <div className="px-4 py-10 text-sm text-muted">No usage in range.</div>;
  }

  const width = 760;
  const height = 280;
  const paddingLeft = 40;
  const paddingRight = 22;
  const paddingTop = 20;
  const paddingBottom = 42;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;
  const maxValue = buildChartMax(buckets.map((bucket) => bucket.totalTokens));
  const points = buckets.map((bucket, index) => {
    const x = paddingLeft + (buckets.length === 1 ? innerWidth / 2 : (index / (buckets.length - 1)) * innerWidth);
    const y = paddingTop + innerHeight - ((bucket.totalTokens / maxValue) * innerHeight);
    return { ...bucket, x, y };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points.at(-1)?.x ?? paddingLeft} ${paddingTop + innerHeight} L ${points[0]?.x ?? paddingLeft} ${paddingTop + innerHeight} Z`;
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const value = Math.round((maxValue / 4) * (4 - index));
    const y = paddingTop + ((innerHeight / 4) * index);
    return { value, y };
  });

  return (
    <div className="px-4 py-4">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-[18rem] w-full">
        <defs>
          <linearGradient id="token-usage-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={palette.areaTop} />
            <stop offset="55%" stopColor={palette.areaMid} />
            <stop offset="100%" stopColor={palette.areaBottom} />
          </linearGradient>
        </defs>
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={paddingLeft} x2={width - paddingRight} y1={tick.y} y2={tick.y} stroke="color-mix(in srgb, var(--color-border) 78%, transparent)" strokeDasharray="4 6" />
            <text x={paddingLeft - 8} y={tick.y + 4} textAnchor="end" fill="var(--color-muted)" fontSize="10">
              {formatCompactNumber(tick.value)}
            </text>
          </g>
        ))}
        <path d={areaPath} fill="url(#token-usage-area)" />
        <path d={linePath} fill="none" stroke={palette.primary} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((point) => (
          <g key={point.periodStart}>
            <circle cx={point.x} cy={point.y} r="4.5" fill={palette.markerFill} stroke={palette.secondary} strokeWidth="2" />
          </g>
        ))}
        {points.map((point, index) => {
          if (points.length > 10 && index % Math.ceil(points.length / 6) !== 0 && index !== points.length - 1) return null;
          return (
            <text key={`${point.periodStart}-label`} x={point.x} y={height - 14} textAnchor="middle" fill="var(--color-muted)" fontSize="10">
              {point.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function StackedUsageBar({
  promptTokens,
  completionTokens,
  totalTokens,
  palette,
}: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  palette: TokenUsageVisualPalette;
}) {
  const promptPct = totalTokens > 0 ? (promptTokens / totalTokens) * 100 : 0;
  const completionPct = totalTokens > 0 ? (completionTokens / totalTokens) * 100 : 0;

  return (
    <div className="h-3 overflow-hidden rounded-full border border-border bg-paper">
      <div className="flex h-full w-full">
        <div style={{ width: `${promptPct}%`, backgroundColor: palette.primary }} className="h-full" />
        <div style={{ width: `${completionPct}%`, backgroundColor: palette.secondary }} className="h-full" />
      </div>
    </div>
  );
}

function VisualMeter({
  value,
  accent,
}: {
  value: number;
  accent: string;
}) {
  return (
    <div className="h-2 overflow-hidden rounded-full border border-border bg-paper">
      <div
        className="h-full rounded-full"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: `linear-gradient(90deg, ${accent}, ${mixHex(accent, '#ffffff', 0.28)})`,
        }}
      />
    </div>
  );
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
  const { loading: profileLoading } = useProfile();
  const { settings } = useTimeFormat();
  const { theme } = useTheme();
  const [granularity, setGranularity] = useState<UsageGranularity>('day');
  const [sourceFilter, setSourceFilter] = useState<UsageSourceFilter>('all');
  const [startDate, setStartDate] = useState(() => isoDateDaysAgo(29));
  const [endDate, setEndDate] = useState(() => formatDateInputValue(new Date(), getTimeFormatSettings().timezone));
  const [sortKey, setSortKey] = useState<SortKey>('totalTokens');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [viewMode, setViewMode] = useState<UsageViewMode>('table');
  const [data, setData] = useState<TokenUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pauseSavingUserId, setPauseSavingUserId] = useState<string | null>(null);
  const accessResolved = !authLoading && !profileLoading;
  const viewerIsAdmin = data?.viewer?.isAdmin === true;
  const canManageServerFallback = viewerIsAdmin && data?.viewer?.email === SERVER_FALLBACK_CONTROL_ADMIN_EMAIL;

  const loadUsage = async () => {
    if (!user) return;
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
    if (!accessResolved || !user) return;
    void loadUsage();
  }, [accessResolved, user, granularity, settings.timezone, sourceFilter, startDate, endDate]);

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

  const handleToggleServerFallbackPause = async () => {
    if (!selectedUser || !canManageServerFallback) return;
    setPauseSavingUserId(selectedUser.userId);
    setError(null);
    try {
      const authHeader = await getAuthHeader();
      if (!authHeader) throw new Error('Please sign in again.');

      const paused = !(selectedUser.serverFallbackPaused === true);
      const response = await fetch(`/api/admin/token-usage/server-fallback/${selectedUser.userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ paused }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; paused?: boolean };
      if (!response.ok) {
        throw new Error(payload.error?.trim() || 'Failed to update server fallback control.');
      }

      setData((current) => {
        if (!current) return current;
        return {
          ...current,
          users: current.users.map((entry) => (
            entry.userId === selectedUser.userId
              ? { ...entry, serverFallbackPaused: payload.paused === true }
              : entry
          )),
        };
      });
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Failed to update server fallback control.');
    } finally {
      setPauseSavingUserId(null);
    }
  };

  const aggregateBuckets = useMemo(() => {
    const bucketMap = new Map<string, UsageBucket>();
    for (const userRow of data?.users ?? []) {
      for (const bucket of userRow.buckets) {
        const existing = bucketMap.get(bucket.periodStart);
        if (existing) {
          existing.promptTokens += bucket.promptTokens;
          existing.completionTokens += bucket.completionTokens;
          existing.totalTokens += bucket.totalTokens;
          existing.requestCount += bucket.requestCount;
        } else {
          bucketMap.set(bucket.periodStart, { ...bucket });
        }
      }
    }
    return [...bucketMap.values()].sort((left, right) => left.periodStart.localeCompare(right.periodStart));
  }, [data?.users]);

  const allUsageEntries = useMemo(
    () => (data?.users ?? []).flatMap((entry) => entry.usageEntries),
    [data?.users],
  );
  const visualPalette = useMemo(() => buildVisualPalette(theme.colors), [theme]);

  const providerSummary = useMemo(() => {
    const providerMap = new Map<string, {
      provider: string;
      modelSet: Set<string>;
      requestCount: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
    }>();
    for (const entry of allUsageEntries) {
      const key = entry.provider.trim() || 'unknown';
      if (!providerMap.has(key)) {
        providerMap.set(key, {
          provider: key,
          modelSet: new Set<string>(),
          requestCount: 0,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
        });
      }
      const current = providerMap.get(key)!;
      current.requestCount += 1;
      current.totalTokens += entry.totalTokens;
      current.promptTokens += entry.promptTokens;
      current.completionTokens += entry.completionTokens;
      if (entry.model.trim()) current.modelSet.add(entry.model.trim());
    }
    return [...providerMap.values()]
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .map((entry, index) => ({ ...entry, color: visualPalette.series[index % visualPalette.series.length] }));
  }, [allUsageEntries, visualPalette.series]);

  const featureSummary = useMemo(() => {
    const featureMap = new Map<string, {
      feature: string;
      requestCount: number;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
    }>();
    for (const entry of allUsageEntries) {
      const key = entry.feature || entry.routePath || 'unknown';
      if (!featureMap.has(key)) {
        featureMap.set(key, {
          feature: key,
          requestCount: 0,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
        });
      }
      const current = featureMap.get(key)!;
      current.requestCount += 1;
      current.totalTokens += entry.totalTokens;
      current.promptTokens += entry.promptTokens;
      current.completionTokens += entry.completionTokens;
    }
    return [...featureMap.values()].sort((left, right) => right.totalTokens - left.totalTokens);
  }, [allUsageEntries]);

  const topVisualUsers = useMemo(
    () => populatedUsers.slice(0, 8).map((entry, index) => ({ ...entry, color: visualPalette.series[index % visualPalette.series.length] })),
    [populatedUsers, visualPalette.series],
  );

  const peakBucket = useMemo(
    () => aggregateBuckets.reduce<UsageBucket | null>((peak, bucket) => (!peak || bucket.totalTokens > peak.totalTokens ? bucket : peak), null),
    [aggregateBuckets],
  );

  const averageTokensPerRequest = useMemo(() => {
    const totalRequests = data?.totals.requestCount ?? 0;
    const totalTokens = data?.totals.totalTokens ?? 0;
    return totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0;
  }, [data?.totals.requestCount, data?.totals.totalTokens]);

  const totalPromptShare = percentage(data?.totals.promptTokens ?? 0, data?.totals.totalTokens ?? 0);
  const totalCompletionShare = percentage(data?.totals.completionTokens ?? 0, data?.totals.totalTokens ?? 0);

  return (
    <div className="app-page-width app-page-width--wide mx-auto max-w-7xl p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-accent">{viewerIsAdmin ? 'Admin' : 'Personal'}</p>
          <h1 className="font-sans text-3xl font-extrabold tracking-tight text-heading">Token Usage</h1>
          <p className="mt-1 text-sm text-muted">
            {viewerIsAdmin
              ? (
                sourceFilter === 'server'
                  ? 'Server fallback API key token usage across Odyssey users.'
                  : 'Token usage across Odyssey users for all logged AI API key activity.'
              )
              : (
                sourceFilter === 'server'
                  ? 'Your server fallback token usage for the selected range.'
                  : 'Your token usage for all logged AI API key activity in the selected range.'
              )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md border border-border bg-surface p-1">
            {(['table', 'visuals'] as UsageViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] transition-colors ${
                  viewMode === mode
                    ? 'bg-surface2 text-heading'
                    : 'text-muted hover:text-heading'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { void loadUsage(); }}
            disabled={loading || !user}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-heading transition-colors hover:bg-surface2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-8 grid gap-3 lg:grid-cols-4">
        <div className="border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <Users size={13} />
            {viewerIsAdmin ? 'Users With Usage' : 'Accounts With Usage'}
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

      {viewMode === 'table' ? (
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
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 xl:grid-cols-3">
            <VisualStatCard
              label="Prompt Share"
              value={`${Math.round(totalPromptShare)}%`}
              detail={`${formatNumber(data?.totals.promptTokens ?? 0)} prompt tokens across the selected range.`}
              accent={visualPalette.primary}
            />
            <VisualStatCard
              label="Completion Share"
              value={`${Math.round(totalCompletionShare)}%`}
              detail={`${formatNumber(data?.totals.completionTokens ?? 0)} completion tokens generated in the same range.`}
              accent={visualPalette.secondary}
            />
            <VisualStatCard
              label="Average Request Size"
              value={`${formatCompactNumber(averageTokensPerRequest)} tok`}
              detail={`${formatNumber(data?.totals.requestCount ?? 0)} total requests spread across ${formatNumber(populatedUsers.length)} active users.`}
              accent={visualPalette.tertiary}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.65fr_1fr]">
            <section className="overflow-hidden border border-border bg-surface">
              <div className="border-b border-border bg-surface2/60 px-4 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-heading">Usage Trend</h2>
                    <p className="mt-1 text-xs text-muted">Total tokens by {granularity} across the filtered date range.</p>
                  </div>
                  {peakBucket && (
                    <div className="text-right text-xs text-muted">
                      <div className="uppercase tracking-[0.16em]">Peak bucket</div>
                      <div className="mt-1 text-sm font-semibold text-heading">{peakBucket.label}</div>
                      <div style={{ color: visualPalette.primary }}>{formatNumber(peakBucket.totalTokens)} tokens</div>
                    </div>
                  )}
                </div>
              </div>
              {loading ? (
                <div className="px-4 py-10 text-sm text-muted">Loading visuals…</div>
              ) : (
                <UsageTrendChart buckets={aggregateBuckets} palette={visualPalette} />
              )}
            </section>

            <section className="overflow-hidden border border-border bg-surface">
              <div className="border-b border-border bg-surface2/60 px-4 py-3">
                <h2 className="text-sm font-semibold text-heading">Provider Mix</h2>
                <p className="mt-1 text-xs text-muted">Token share, request count, and model spread by provider.</p>
              </div>
              <div className="space-y-3 px-4 py-4">
                {loading ? (
                  <div className="py-6 text-sm text-muted">Loading visuals…</div>
                ) : providerSummary.length === 0 ? (
                  <div className="py-6 text-sm text-muted">No usage in range.</div>
                ) : (
                  providerSummary.map((provider) => (
                    <div
                      key={provider.provider}
                      className="border border-border p-3"
                      style={{
                        background: `linear-gradient(180deg, color-mix(in srgb, ${provider.color} 12%, var(--color-surface)) 0%, var(--color-surface) 100%)`,
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-heading">{formatProviderLabel(provider.provider)}</div>
                          <div className="text-[11px] text-muted">{provider.modelSet.size} model{provider.modelSet.size === 1 ? '' : 's'} observed</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-heading">{formatCompactNumber(provider.totalTokens)}</div>
                          <div className="text-[11px] text-muted">{Math.round(percentage(provider.totalTokens, data?.totals.totalTokens ?? 0))}% of total</div>
                        </div>
                      </div>
                      <VisualMeter value={percentage(provider.totalTokens, data?.totals.totalTokens ?? 0)} accent={provider.color} />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                        <span>{formatNumber(provider.requestCount)} requests</span>
                        <span>{formatCompactNumber(provider.promptTokens)} in / {formatCompactNumber(provider.completionTokens)} out</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
            <section className="overflow-hidden border border-border bg-surface">
              <div className="border-b border-border bg-surface2/60 px-4 py-3">
                <h2 className="text-sm font-semibold text-heading">Top User Loadout</h2>
                <p className="mt-1 text-xs text-muted">Prompt vs. completion composition for the busiest users in the current range.</p>
              </div>
              <div className="space-y-4 px-4 py-4">
                {loading ? (
                  <div className="py-6 text-sm text-muted">Loading visuals…</div>
                ) : topVisualUsers.length === 0 ? (
                  <div className="py-6 text-sm text-muted">No usage in range.</div>
                ) : (
                  topVisualUsers.map((entry) => (
                    <button
                      key={entry.userId}
                      type="button"
                      onClick={() => setSelectedUserId(entry.userId)}
                      className="block w-full border border-border p-3 text-left transition-colors hover:border-accent/35 hover:bg-surface2/40"
                      style={{
                        background: `linear-gradient(180deg, color-mix(in srgb, ${entry.color} 10%, var(--color-surface)) 0%, var(--color-surface) 100%)`,
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-heading">{entry.displayName}</div>
                          <div className="text-[11px] text-muted">{entry.email || 'No email on profile'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-heading">{formatCompactNumber(entry.totalTokens)}</div>
                          <div className="text-[11px] text-muted">{formatNumber(entry.requestCount)} requests</div>
                        </div>
                      </div>
                      <StackedUsageBar
                        promptTokens={entry.promptTokens}
                        completionTokens={entry.completionTokens}
                        totalTokens={entry.totalTokens}
                        palette={visualPalette}
                      />
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                        <span style={{ color: visualPalette.primary }}>{formatCompactNumber(entry.promptTokens)} prompt</span>
                        <span style={{ color: visualPalette.secondary }}>{formatCompactNumber(entry.completionTokens)} completion</span>
                        <span>{Math.round(percentage(entry.totalTokens, data?.totals.totalTokens ?? 0))}% of total</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="overflow-hidden border border-border bg-surface">
              <div className="border-b border-border bg-surface2/60 px-4 py-3">
                <h2 className="text-sm font-semibold text-heading">Feature Hotspots</h2>
                <p className="mt-1 text-xs text-muted">Most expensive product surfaces based on the same logged usage rows.</p>
              </div>
              <div className="space-y-3 px-4 py-4">
                {loading ? (
                  <div className="py-6 text-sm text-muted">Loading visuals…</div>
                ) : featureSummary.length === 0 ? (
                  <div className="py-6 text-sm text-muted">No usage in range.</div>
                ) : (
                  featureSummary.slice(0, 8).map((feature, index) => {
                    const accent = visualPalette.series[index % visualPalette.series.length];
                    return (
                      <div
                        key={feature.feature}
                        className="border border-border p-3"
                        style={{
                          background: `linear-gradient(180deg, color-mix(in srgb, ${accent} 10%, var(--color-surface)) 0%, var(--color-surface) 100%)`,
                        }}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-heading">{formatFeatureLabel(feature.feature)}</div>
                            <div className="text-[11px] text-muted">{formatNumber(feature.requestCount)} requests</div>
                          </div>
                          <div className="text-right text-sm font-semibold text-heading">{formatCompactNumber(feature.totalTokens)}</div>
                        </div>
                        <VisualMeter value={percentage(feature.totalTokens, data?.totals.totalTokens ?? 0)} accent={accent} />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>{Math.round(percentage(feature.totalTokens, data?.totals.totalTokens ?? 0))}% of total</span>
                          <span>{formatCompactNumber(feature.promptTokens)} in / {formatCompactNumber(feature.completionTokens)} out</span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>
      )}

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
                {canManageServerFallback && (
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { void handleToggleServerFallbackPause(); }}
                      disabled={pauseSavingUserId === selectedUser.userId}
                      className={`inline-flex items-center justify-center border px-3 py-2 text-[11px] font-sans font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-50 ${
                        selectedUser.serverFallbackPaused
                          ? 'border-accent3/30 bg-accent3/10 text-accent3 hover:bg-accent3/15'
                          : 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15'
                      }`}
                    >
                      {pauseSavingUserId === selectedUser.userId
                        ? 'Saving…'
                        : selectedUser.serverFallbackPaused
                          ? 'Resume Server Fallback'
                          : 'Pause Server Fallback'}
                    </button>
                    <span className={`text-[11px] ${selectedUser.serverFallbackPaused ? 'text-danger' : 'text-muted'}`}>
                      {selectedUser.serverFallbackPaused
                        ? 'Server fallback OpenAI calls are paused for this user.'
                        : 'Server fallback OpenAI calls are currently allowed for this user.'}
                    </span>
                  </div>
                )}
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
