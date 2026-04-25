import type { FastifyInstance } from 'fastify';
import type { ChatResult } from '../ai-providers.js';
import {
  getAuthorizedServerFallbackAdmin,
  getServerFallbackPauseMap,
  setServerFallbackPausedForUser,
} from '../lib/server-fallback-controls.js';
import { supabase } from '../lib/supabase.js';

const TOKEN_USAGE_ADMIN_EMAILS = new Set([
  'kyle.hicks@nps.edu',
  'jasavatt@nps.edu',
  'dtpierce@nps.edu',
]);

type UsageGranularity = 'day' | 'week' | 'month';
type TokenUsageKeySource = 'server' | 'user';
type TokenUsageScope = 'all' | TokenUsageKeySource;

interface TokenUsageProfileRow {
  id: string;
  display_name: string | null;
  email: string | null;
}

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
  keySource: TokenUsageKeySource;
  feature: string;
  routePath: string;
  projectId: string | null;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface LogAiTokenUsageInput {
  authHeader: string | undefined;
  result: ChatResult;
  feature: string;
  routePath: string;
  projectId?: string | null;
  knownUserId?: string | null;
}

function normalizeDateOnly(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return fallback;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function normalizeTimeZone(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return 'UTC';
  }
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`;
}

function addDaysToDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + days);
  return formatDateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

function getDatePartsInTimeZone(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get('year') ?? '0'),
    month: Number(map.get('month') ?? '1'),
    day: Number(map.get('day') ?? '1'),
    hour: Number(map.get('hour') ?? '0'),
    minute: Number(map.get('minute') ?? '0'),
    second: Number(map.get('second') ?? '0'),
  };
}

function getTimeZoneOffsetMs(value: Date, timeZone: string): number {
  const parts = getDatePartsInTimeZone(value, timeZone);
  const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return zonedAsUtc - value.getTime();
}

function zonedDateStartToUtc(value: string, timeZone: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  let utcTime = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const offset = getTimeZoneOffsetMs(new Date(utcTime), timeZone);
    const nextUtcTime = Date.UTC(year, month - 1, day, 0, 0, 0, 0) - offset;
    if (nextUtcTime === utcTime) break;
    utcTime = nextUtcTime;
  }
  return new Date(utcTime);
}

function getDateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const parts = getDatePartsInTimeZone(value, timeZone);
  return formatDateKey(parts.year, parts.month, parts.day);
}

function getWeekStartDateKey(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + offset);
  return formatDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getBucketInfo(value: string, granularity: UsageGranularity, timeZone: string): { periodStart: string; label: string } {
  const dateKey = getDateKeyInTimeZone(value, timeZone);
  if (granularity === 'day') {
    return { periodStart: dateKey, label: dateKey };
  }

  if (granularity === 'week') {
    const periodStart = getWeekStartDateKey(dateKey);
    return {
      periodStart,
      label: `${periodStart} to ${addDaysToDateKey(periodStart, 6)}`,
    };
  }

  const [year, month] = dateKey.split('-');
  return {
    periodStart: `${year}-${month}-01`,
    label: `${year}-${month}`,
  };
}

async function getAuthorizedTokenUsageUser(authHeader: string | undefined) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user?.id) return null;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('display_name, email')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) return null;

  const emailCandidates = [
    user.email?.trim().toLowerCase() ?? '',
    profile?.email?.trim().toLowerCase() ?? '',
    typeof user.user_metadata?.email === 'string' ? user.user_metadata.email.trim().toLowerCase() : '',
  ];
  const authorizedEmail = emailCandidates.find((value) => TOKEN_USAGE_ADMIN_EMAILS.has(value));

  return {
    userId: user.id,
    email: authorizedEmail ?? emailCandidates.find(Boolean) ?? '',
    displayName: (profile?.display_name ?? '').trim(),
    isAdmin: Boolean(authorizedEmail),
  };
}

export async function logAiTokenUsage(input: LogAiTokenUsageInput) {
  if (!input.result.keySource || !input.result.usage || input.result.usage.totalTokens <= 0) {
    return;
  }

  let userId = input.knownUserId ?? null;
  let email = '';
  let displayName = '';

  if (input.authHeader?.startsWith('Bearer ')) {
    const token = input.authHeader.slice(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user?.id) return;
    userId = user.id;
    email = user.email?.trim().toLowerCase() ?? '';

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', user.id)
      .maybeSingle();
    displayName = profile?.display_name?.trim() ?? '';
  }

  if (!userId) return;

  const { error } = await supabase
    .from('fallback_token_usage_logs')
    .insert({
      user_id: userId,
      email: email || null,
      display_name: displayName || null,
      key_source: input.result.keySource,
      feature: input.feature,
      route_path: input.routePath,
      project_id: input.projectId ?? null,
      provider: input.result.provider,
      model: input.result.model,
      prompt_tokens: input.result.usage.promptTokens,
      completion_tokens: input.result.usage.completionTokens,
      total_tokens: input.result.usage.totalTokens,
    });

  if (error) {
    throw error;
  }
}

export async function tokenUsageRoutes(server: FastifyInstance) {
  server.get<{
    Querystring: {
      start?: string;
      end?: string;
      granularity?: UsageGranularity;
      timeZone?: string;
      keySource?: TokenUsageScope;
    };
  }>('/admin/token-usage', async (request, reply) => {
    const authorized = await getAuthorizedTokenUsageUser(request.headers.authorization);
    if (!authorized) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const timeZone = normalizeTimeZone(request.query.timeZone);
    const today = getDateKeyInTimeZone(new Date(), timeZone);
    const defaultStart = addDaysToDateKey(today, -29);
    const start = normalizeDateOnly(request.query.start, defaultStart);
    const end = normalizeDateOnly(request.query.end, today);
    const granularity: UsageGranularity = request.query.granularity === 'week' || request.query.granularity === 'month'
      ? request.query.granularity
      : 'day';
    const keySource: TokenUsageScope = request.query.keySource === 'server' || request.query.keySource === 'user'
      ? request.query.keySource
      : 'all';

    const startDateUtc = zonedDateStartToUtc(start, timeZone);
    const endDateUtc = zonedDateStartToUtc(end, timeZone);
    if (startDateUtc > endDateUtc) {
      return reply.status(400).send({ error: 'Start date must be on or before end date.' });
    }

    const rangeEndExclusive = zonedDateStartToUtc(addDaysToDateKey(end, 1), timeZone).toISOString();
    const logsQuery = supabase
      .from('fallback_token_usage_logs')
      .select('user_id, email, display_name, key_source, feature, route_path, project_id, provider, model, prompt_tokens, completion_tokens, total_tokens, created_at')
      .gte('created_at', startDateUtc.toISOString())
      .lt('created_at', rangeEndExclusive)
      .order('created_at', { ascending: true });

    if (keySource !== 'all') {
      logsQuery.eq('key_source', keySource);
    }

    if (!authorized.isAdmin) {
      logsQuery.eq('user_id', authorized.userId);
    }

    const profilesQuery = supabase.from('profiles').select('id, display_name, email');
    if (authorized.isAdmin) {
      profilesQuery.order('display_name', { ascending: true });
    } else {
      profilesQuery.eq('id', authorized.userId);
    }

    const [profilesRes, logsRes] = await Promise.all([profilesQuery, logsQuery]);

    if (profilesRes.error) {
      server.log.error({ err: profilesRes.error }, 'Failed to load profiles for token usage');
      return reply.status(500).send({ error: 'Failed to load users.' });
    }
    if (logsRes.error) {
      server.log.error({ err: logsRes.error }, 'Failed to load token usage logs');
      return reply.status(500).send({ error: 'Failed to load token usage.' });
    }

    const profileRows = (profilesRes.data ?? []) as TokenUsageProfileRow[];
    const profileMap = new Map(profileRows.map((profile) => [profile.id, profile]));
    const pausedFallbackMap = await getServerFallbackPauseMap(profileRows.map((profile) => profile.id));
    const usageMap = new Map<string, {
      userId: string;
      displayName: string;
      email: string;
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      requestCount: number;
      lastUsage: UsageEntry | null;
      usageEntries: UsageEntry[];
      buckets: Map<string, UsageBucket>;
    }>();

    for (const row of logsRes.data ?? []) {
      const userId = row.user_id as string;
      const profile = profileMap.get(userId);
      const displayName = profile?.display_name?.trim() || (typeof row.display_name === 'string' ? row.display_name.trim() : '') || userId;
      const email = profile?.email?.trim().toLowerCase() || (typeof row.email === 'string' ? row.email.trim().toLowerCase() : '');
      const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
      const bucketInfo = getBucketInfo(createdAt, granularity, timeZone);
      const bucketKey = bucketInfo.periodStart;

      if (!usageMap.has(userId)) {
        usageMap.set(userId, {
          userId,
          displayName,
          email,
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          requestCount: 0,
          lastUsage: null,
          usageEntries: [],
          buckets: new Map<string, UsageBucket>(),
        });
      }

      const usage = usageMap.get(userId)!;
      if (!usage.buckets.has(bucketKey)) {
        usage.buckets.set(bucketKey, {
          periodStart: bucketKey,
          label: bucketInfo.label,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          requestCount: 0,
        });
      }

      const bucket = usage.buckets.get(bucketKey)!;
      const promptTokens = Number(row.prompt_tokens ?? 0);
      const completionTokens = Number(row.completion_tokens ?? 0);
      const totalTokens = Number(row.total_tokens ?? 0);
      const rowKeySource: TokenUsageKeySource = row.key_source === 'user' ? 'user' : 'server';
      const entry: UsageEntry = {
        createdAt,
        keySource: rowKeySource,
        feature: typeof row.feature === 'string' ? row.feature : '',
        routePath: typeof row.route_path === 'string' ? row.route_path : '',
        projectId: typeof row.project_id === 'string' ? row.project_id : null,
        provider: typeof row.provider === 'string' ? row.provider : '',
        model: typeof row.model === 'string' ? row.model : '',
        promptTokens,
        completionTokens,
        totalTokens,
      };

      usage.promptTokens += promptTokens;
      usage.completionTokens += completionTokens;
      usage.totalTokens += totalTokens;
      usage.requestCount += 1;
      usage.lastUsage = entry;
      usage.usageEntries.push(entry);

      bucket.promptTokens += promptTokens;
      bucket.completionTokens += completionTokens;
      bucket.totalTokens += totalTokens;
      bucket.requestCount += 1;
    }

    const userRows = profileRows.length > 0
      ? profileRows
      : [{
        id: authorized.userId,
        display_name: authorized.displayName || null,
        email: authorized.email || null,
      }];

    const users = userRows
      .map((profile) => {
        const usage = usageMap.get(profile.id);
        const fallbackName = usage?.displayName || authorized.displayName || authorized.email || profile.id;
        const fallbackEmail = usage?.email || authorized.email;
        return {
          userId: profile.id,
          displayName: profile.display_name?.trim() || profile.email?.trim() || fallbackName,
          email: profile.email?.trim().toLowerCase() || fallbackEmail,
          serverFallbackPaused: pausedFallbackMap.get(profile.id) === true,
          totalTokens: usage?.totalTokens ?? 0,
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          requestCount: usage?.requestCount ?? 0,
          lastUsage: usage?.lastUsage ?? null,
          usageEntries: usage ? [...usage.usageEntries].sort((left, right) => right.createdAt.localeCompare(left.createdAt)) : [],
          buckets: usage
            ? [...usage.buckets.values()].sort((left, right) => left.periodStart.localeCompare(right.periodStart))
            : [],
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));

    return {
      viewer: authorized,
      granularity,
      keySource,
      timeZone,
      range: { start, end },
      users,
      totals: {
        totalTokens: users.reduce((sum, user) => sum + user.totalTokens, 0),
        promptTokens: users.reduce((sum, user) => sum + user.promptTokens, 0),
        completionTokens: users.reduce((sum, user) => sum + user.completionTokens, 0),
        requestCount: users.reduce((sum, user) => sum + user.requestCount, 0),
      },
    };
  });

  server.patch<{
    Params: { userId: string };
    Body: { paused?: boolean };
  }>('/admin/token-usage/server-fallback/:userId', async (request, reply) => {
    const authorizedAdmin = await getAuthorizedServerFallbackAdmin(request.headers.authorization);
    if (!authorizedAdmin) {
      return reply.status(404).send({ error: 'Not found' });
    }

    const userId = request.params.userId?.trim();
    const paused = request.body?.paused === true;
    if (!userId) {
      return reply.status(400).send({ error: 'User id is required.' });
    }

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, display_name, email')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      server.log.error({ err: error, userId }, 'Failed to load profile for server fallback control');
      return reply.status(500).send({ error: 'Failed to update server fallback control.' });
    }
    if (!profile?.id) {
      return reply.status(404).send({ error: 'User not found.' });
    }

    try {
      await setServerFallbackPausedForUser(userId, paused, authorizedAdmin.userId);
      return {
        ok: true,
        userId,
        paused,
        user: {
          displayName: profile.display_name?.trim() || profile.email?.trim() || profile.id,
          email: profile.email?.trim().toLowerCase() ?? '',
        },
      };
    } catch (updateError) {
      server.log.error({ err: updateError, userId, paused }, 'Failed to update server fallback control');
      return reply.status(500).send({ error: 'Failed to update server fallback control.' });
    }
  });
}
