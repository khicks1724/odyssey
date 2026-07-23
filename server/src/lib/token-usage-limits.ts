import { supabase } from './supabase.js';

export type TokenUsageLimitPeriod = 'daily' | 'weekly' | 'monthly';
export type TokenUsageKeyScope = 'all' | 'server' | 'user';
export type TokenUsageProviderFamily = 'all' | 'openai' | 'anthropic' | 'google_ai' | 'genai_mil' | 'nvidia' | 'gemma4' | 'other';

export interface TokenUsageLimitPeriodStatus {
  period: TokenUsageLimitPeriod;
  limit: number | null;
  used: number;
  percentage: number;
  periodStart: string;
  resetsAt: string;
  reached: boolean;
}

export interface UserTokenUsageLimitStatus {
  daily: TokenUsageLimitPeriodStatus;
  weekly: TokenUsageLimitPeriodStatus;
  monthly: TokenUsageLimitPeriodStatus;
}

export interface TokenUsageRateStatus {
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
  requestsUsed: number;
  tokensUsed: number;
  requestsPercentage: number;
  tokensPercentage: number;
  requestsReached: boolean;
  tokensReached: boolean;
  windowStartedAt: string;
  resetsAt: string;
}

export interface UserTokenUsagePolicyStatus extends UserTokenUsageLimitStatus {
  id: string;
  userId: string;
  keySource: TokenUsageKeyScope;
  providerFamily: TokenUsageProviderFamily;
  enabled: boolean;
  revision: number;
  updatedAt: string;
  rate: TokenUsageRateStatus;
}

export interface UserTokenUsagePolicyInput {
  id?: string | null;
  keySource: TokenUsageKeyScope;
  providerFamily: TokenUsageProviderFamily;
  dailyLimit: number | null;
  weeklyLimit: number | null;
  monthlyLimit: number | null;
  requestsPerMinute: number | null;
  tokensPerMinute: number | null;
  enabled: boolean;
}

export interface UserTokenUsageLimitsInput {
  dailyLimit: number | null;
  weeklyLimit: number | null;
  monthlyLimit: number | null;
}

export type TokenUsageLimitViolation = Omit<TokenUsageLimitPeriodStatus, 'period'> & {
  period: TokenUsageLimitPeriod | 'requests_per_minute' | 'tokens_per_minute';
  policyId?: string;
  keySource?: TokenUsageKeyScope;
  providerFamily?: TokenUsageProviderFamily;
  metric?: 'tokens' | 'requests';
};

type TokenUsagePolicyRow = {
  id: string;
  user_id: string;
  key_source: TokenUsageKeyScope;
  provider_family: TokenUsageProviderFamily;
  daily_limit: number | string | null;
  weekly_limit: number | string | null;
  monthly_limit: number | string | null;
  requests_per_minute: number | string | null;
  tokens_per_minute: number | string | null;
  enabled: boolean;
  revision: number | string | null;
  updated_at: string;
};

type TokenUsageLogRow = {
  user_id: string;
  key_source: 'server' | 'user';
  provider_family: string | null;
  provider: string;
  total_tokens: number | string | null;
  created_at: string;
};

function toSafeNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function nullableLimit(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function percentage(used: number, limit: number | null) {
  return limit ? Math.round((used / limit) * 10_000) / 100 : 0;
}

export function normalizeTokenUsageProviderFamily(provider: string): Exclude<TokenUsageProviderFamily, 'all'> {
  const normalized = provider.trim().toLowerCase();
  if (normalized.includes('nvidia')) return 'nvidia';
  if (normalized.includes('gemma')) return 'gemma4';
  if (normalized === 'gpt-4o' || normalized.startsWith('openai:')) return 'openai';
  if (normalized.startsWith('claude')) return 'anthropic';
  if (normalized.startsWith('genai-mil')) return 'genai_mil';
  if (normalized.startsWith('gemini')) return 'google_ai';
  return 'other';
}

function utcPeriodBounds(at: Date) {
  const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const weekStart = new Date(dayStart);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));

  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);
  const monthEnd = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

  return { dayStart, dayEnd, weekStart, weekEnd, monthStart, monthEnd };
}

function buildPeriodStatus(
  period: TokenUsageLimitPeriod,
  limit: number | null,
  used: number,
  periodStart: string,
  resetsAt: string,
): TokenUsageLimitPeriodStatus {
  return {
    period,
    limit,
    used,
    percentage: percentage(used, limit),
    periodStart,
    resetsAt,
    reached: limit !== null && used >= limit,
  };
}

function emptyStatus(at: Date): UserTokenUsageLimitStatus {
  const bounds = utcPeriodBounds(at);
  return {
    daily: buildPeriodStatus('daily', null, 0, bounds.dayStart.toISOString(), bounds.dayEnd.toISOString()),
    weekly: buildPeriodStatus('weekly', null, 0, bounds.weekStart.toISOString(), bounds.weekEnd.toISOString()),
    monthly: buildPeriodStatus('monthly', null, 0, bounds.monthStart.toISOString(), bounds.monthEnd.toISOString()),
  };
}

function logMatchesPolicy(log: TokenUsageLogRow, policy: TokenUsagePolicyRow) {
  const providerFamily = (log.provider_family || normalizeTokenUsageProviderFamily(log.provider)) as TokenUsageProviderFamily;
  return (policy.key_source === 'all' || log.key_source === policy.key_source)
    && (policy.provider_family === 'all' || providerFamily === policy.provider_family);
}

async function loadUsageLogs(userIds: string[], from: Date): Promise<TokenUsageLogRow[]> {
  const rows: TokenUsageLogRow[] = [];
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from('fallback_token_usage_logs')
      .select('user_id,key_source,provider_family,provider,total_tokens,created_at')
      .in('user_id', userIds)
      .gte('created_at', from.toISOString())
      .order('created_at', { ascending: true })
      .range(start, start + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as TokenUsageLogRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function buildPolicyStatus(
  policy: TokenUsagePolicyRow,
  logs: TokenUsageLogRow[],
  at: Date,
): UserTokenUsagePolicyStatus {
  const bounds = utcPeriodBounds(at);
  const matchingLogs = logs.filter((log) => logMatchesPolicy(log, policy));
  const sumSince = (start: Date) => matchingLogs.reduce(
    (sum, log) => new Date(log.created_at) >= start ? sum + toSafeNumber(log.total_tokens) : sum,
    0,
  );
  const minuteStart = new Date(at.getTime() - 60_000);
  const minuteLogs = matchingLogs.filter((log) => {
    const createdAt = new Date(log.created_at);
    return createdAt >= minuteStart && createdAt <= at;
  });
  const minuteTokens = minuteLogs.reduce((sum, log) => sum + toSafeNumber(log.total_tokens), 0);
  const requestsPerMinute = nullableLimit(policy.requests_per_minute);
  const tokensPerMinute = nullableLimit(policy.tokens_per_minute);
  const oldestMinuteLog = minuteLogs[0]?.created_at;
  const minuteReset = oldestMinuteLog
    ? new Date(new Date(oldestMinuteLog).getTime() + 60_000)
    : new Date(at.getTime() + 60_000);

  return {
    id: policy.id,
    userId: policy.user_id,
    keySource: policy.key_source,
    providerFamily: policy.provider_family,
    enabled: policy.enabled,
    revision: toSafeNumber(policy.revision),
    updatedAt: policy.updated_at,
    daily: buildPeriodStatus(
      'daily',
      nullableLimit(policy.daily_limit),
      sumSince(bounds.dayStart),
      bounds.dayStart.toISOString(),
      bounds.dayEnd.toISOString(),
    ),
    weekly: buildPeriodStatus(
      'weekly',
      nullableLimit(policy.weekly_limit),
      sumSince(bounds.weekStart),
      bounds.weekStart.toISOString(),
      bounds.weekEnd.toISOString(),
    ),
    monthly: buildPeriodStatus(
      'monthly',
      nullableLimit(policy.monthly_limit),
      sumSince(bounds.monthStart),
      bounds.monthStart.toISOString(),
      bounds.monthEnd.toISOString(),
    ),
    rate: {
      requestsPerMinute,
      tokensPerMinute,
      requestsUsed: minuteLogs.length,
      tokensUsed: minuteTokens,
      requestsPercentage: percentage(minuteLogs.length, requestsPerMinute),
      tokensPercentage: percentage(minuteTokens, tokensPerMinute),
      requestsReached: requestsPerMinute !== null && minuteLogs.length >= requestsPerMinute,
      tokensReached: tokensPerMinute !== null && minuteTokens >= tokensPerMinute,
      windowStartedAt: minuteStart.toISOString(),
      resetsAt: minuteReset.toISOString(),
    },
  };
}

export async function getTokenUsagePolicyStatusMap(
  userIds: string[],
  at = new Date(),
): Promise<Map<string, UserTokenUsagePolicyStatus[]>> {
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  const result = new Map<string, UserTokenUsagePolicyStatus[]>();
  for (const userId of normalizedUserIds) result.set(userId, []);
  if (normalizedUserIds.length === 0) return result;

  const { data, error } = await supabase
    .from('user_token_usage_policies')
    .select('*')
    .in('user_id', normalizedUserIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const policies = (data ?? []) as TokenUsagePolicyRow[];
  if (policies.length === 0) return result;

  const bounds = utcPeriodBounds(at);
  const from = new Date(Math.min(bounds.weekStart.getTime(), bounds.monthStart.getTime(), at.getTime() - 60_000));
  const logs = await loadUsageLogs([...new Set(policies.map((policy) => policy.user_id))], from);
  const logsByUser = new Map<string, TokenUsageLogRow[]>();
  for (const log of logs) {
    const current = logsByUser.get(log.user_id) ?? [];
    current.push(log);
    logsByUser.set(log.user_id, current);
  }

  for (const policy of policies) {
    const current = result.get(policy.user_id) ?? [];
    current.push(buildPolicyStatus(policy, logsByUser.get(policy.user_id) ?? [], at));
    result.set(policy.user_id, current);
  }
  return result;
}

export async function getTokenUsageLimitStatusMap(
  userIds: string[],
  at = new Date(),
): Promise<Map<string, UserTokenUsageLimitStatus>> {
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  const policyMap = await getTokenUsagePolicyStatusMap(normalizedUserIds, at);
  return tokenUsageLimitStatusMapFromPolicies(normalizedUserIds, policyMap, at);
}

export function tokenUsageLimitStatusMapFromPolicies(
  userIds: string[],
  policyMap: Map<string, UserTokenUsagePolicyStatus[]>,
  at = new Date(),
): Map<string, UserTokenUsageLimitStatus> {
  const result = new Map<string, UserTokenUsageLimitStatus>();
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  for (const userId of normalizedUserIds) {
    const defaultPolicy = (policyMap.get(userId) ?? []).find((policy) => (
      policy.keySource === 'all' && policy.providerFamily === 'all'
    ));
    result.set(userId, defaultPolicy ?? emptyStatus(at));
  }
  return result;
}

export async function getTokenUsageLimitStatus(
  userId: string,
  at = new Date(),
): Promise<UserTokenUsageLimitStatus> {
  const statusMap = await getTokenUsageLimitStatusMap([userId], at);
  return statusMap.get(userId) ?? emptyStatus(at);
}

export function getReachedTokenUsageLimit(
  status: UserTokenUsageLimitStatus,
): TokenUsageLimitPeriodStatus | null {
  return ([status.daily, status.weekly, status.monthly]
    .filter((entry) => entry.reached)
    .sort((left, right) => right.resetsAt.localeCompare(left.resetsAt))[0] ?? null);
}

function policyViolations(policy: UserTokenUsagePolicyStatus): TokenUsageLimitViolation[] {
  if (!policy.enabled) return [];
  const common = {
    policyId: policy.id,
    keySource: policy.keySource,
    providerFamily: policy.providerFamily,
  };
  const violations: TokenUsageLimitViolation[] = [policy.daily, policy.weekly, policy.monthly]
    .filter((entry) => entry.reached)
    .map((entry) => ({ ...entry, ...common, metric: 'tokens' as const }));
  if (policy.rate.requestsReached) {
    violations.push({
      ...common,
      period: 'requests_per_minute',
      metric: 'requests',
      limit: policy.rate.requestsPerMinute,
      used: policy.rate.requestsUsed,
      percentage: policy.rate.requestsPercentage,
      periodStart: policy.rate.windowStartedAt,
      resetsAt: policy.rate.resetsAt,
      reached: true,
    });
  }
  if (policy.rate.tokensReached) {
    violations.push({
      ...common,
      period: 'tokens_per_minute',
      metric: 'tokens',
      limit: policy.rate.tokensPerMinute,
      used: policy.rate.tokensUsed,
      percentage: policy.rate.tokensPercentage,
      periodStart: policy.rate.windowStartedAt,
      resetsAt: policy.rate.resetsAt,
      reached: true,
    });
  }
  return violations;
}

export async function getReachedTokenUsageLimitForUser(
  userId: string,
  at = new Date(),
  context?: { keySource: 'server' | 'user'; providerFamily: Exclude<TokenUsageProviderFamily, 'all'> },
): Promise<TokenUsageLimitViolation | null> {
  const policyMap = await getTokenUsagePolicyStatusMap([userId], at);
  const policies = (policyMap.get(userId) ?? []).filter((policy) => {
    if (!context) return policy.keySource === 'all' && policy.providerFamily === 'all';
    return (policy.keySource === 'all' || policy.keySource === context.keySource)
      && (policy.providerFamily === 'all' || policy.providerFamily === context.providerFamily);
  });
  return policies
    .flatMap(policyViolations)
    .sort((left, right) => right.resetsAt.localeCompare(left.resetsAt))[0] ?? null;
}

export function buildTokenUsageLimitMessage(status: TokenUsageLimitViolation): string {
  const scope = status.keySource === 'server'
    ? ' for the Odyssey server key'
    : status.keySource === 'user'
      ? ' for personal API keys'
      : '';
  if (status.period === 'requests_per_minute') {
    return `Your request rate limit${scope} of ${status.limit ?? 0} requests per minute has been reached. Try again after ${status.resetsAt}.`;
  }
  if (status.period === 'tokens_per_minute') {
    return `Your token rate limit${scope} of ${status.limit ?? 0} tokens per minute has been reached. Try again after ${status.resetsAt}.`;
  }
  return `Your ${status.period} token limit${scope} of ${status.limit ?? 0} tokens has been reached. AI requests will be available again after ${status.resetsAt}.`;
}

async function syncLegacyGlobalBudget(
  userId: string,
  input: Pick<UserTokenUsagePolicyInput, 'dailyLimit' | 'weeklyLimit' | 'monthlyLimit' | 'enabled'>,
  updatedBy: string,
) {
  const hasPeriodBudget = input.enabled && [input.dailyLimit, input.weeklyLimit, input.monthlyLimit]
    .some((value) => value !== null);
  if (!hasPeriodBudget) {
    const { error } = await supabase.from('user_token_usage_limits').delete().eq('user_id', userId);
    if (error) throw error;
    return;
  }

  const [existingResult, latestAlertResult] = await Promise.all([
    supabase.from('user_token_usage_limits').select('revision').eq('user_id', userId).maybeSingle(),
    supabase
      .from('token_usage_limit_alerts')
      .select('limit_revision')
      .eq('user_id', userId)
      .order('limit_revision', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (existingResult.error) throw existingResult.error;
  if (latestAlertResult.error) throw latestAlertResult.error;
  const nextRevision = Math.max(
    toSafeNumber(existingResult.data?.revision),
    toSafeNumber(latestAlertResult.data?.limit_revision),
  ) + 1;

  const { error } = await supabase.from('user_token_usage_limits').upsert({
    user_id: userId,
    daily_limit: input.dailyLimit,
    weekly_limit: input.weeklyLimit,
    monthly_limit: input.monthlyLimit,
    revision: nextRevision,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (error) throw error;

  const { error: evaluateError } = await supabase.rpc('evaluate_user_token_usage_limits', {
    p_user_id: userId,
    p_at: new Date().toISOString(),
  });
  if (evaluateError) throw evaluateError;
}

export async function setUserTokenUsagePolicy(
  userId: string,
  input: UserTokenUsagePolicyInput,
  updatedBy: string,
): Promise<UserTokenUsagePolicyStatus> {
  const values = {
    user_id: userId,
    key_source: input.keySource,
    provider_family: input.providerFamily,
    daily_limit: input.dailyLimit,
    weekly_limit: input.weeklyLimit,
    monthly_limit: input.monthlyLimit,
    requests_per_minute: input.requestsPerMinute,
    tokens_per_minute: input.tokensPerMinute,
    enabled: input.enabled,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };
  const hasCap = [
    input.dailyLimit,
    input.weeklyLimit,
    input.monthlyLimit,
    input.requestsPerMinute,
    input.tokensPerMinute,
  ].some((value) => value !== null);
  if (!hasCap) throw new Error('Add at least one token budget or rate cap.');

  let policyId = input.id?.trim() || null;
  let movedAwayFromGlobalBudget = false;
  if (policyId) {
    const { data: existing, error: existingError } = await supabase
      .from('user_token_usage_policies')
      .select('id,revision,key_source,provider_family')
      .eq('id', policyId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) throw new Error('Token usage policy not found.');
    movedAwayFromGlobalBudget = existing.key_source === 'all'
      && existing.provider_family === 'all'
      && (input.keySource !== 'all' || input.providerFamily !== 'all');
    const { error } = await supabase
      .from('user_token_usage_policies')
      .update({ ...values, revision: toSafeNumber(existing.revision) + 1 })
      .eq('id', policyId)
      .eq('user_id', userId);
    if (error) throw error;
  } else {
    const { data: existing, error: existingError } = await supabase
      .from('user_token_usage_policies')
      .select('id,revision')
      .eq('user_id', userId)
      .eq('key_source', input.keySource)
      .eq('provider_family', input.providerFamily)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing?.id) {
      const { error } = await supabase
        .from('user_token_usage_policies')
        .update({ ...values, revision: toSafeNumber(existing.revision) + 1 })
        .eq('id', existing.id)
        .eq('user_id', userId);
      if (error) throw error;
      policyId = existing.id as string;
    } else {
      const { data, error } = await supabase
        .from('user_token_usage_policies')
        .insert({ ...values, revision: 1 })
        .select('id')
        .single();
      if (error) throw error;
      policyId = data.id as string;
    }
  }

  if (input.keySource === 'all' && input.providerFamily === 'all') {
    await syncLegacyGlobalBudget(userId, input, updatedBy);
  } else if (movedAwayFromGlobalBudget) {
    const { error } = await supabase.from('user_token_usage_limits').delete().eq('user_id', userId);
    if (error) throw error;
  }

  const policyMap = await getTokenUsagePolicyStatusMap([userId]);
  const status = (policyMap.get(userId) ?? []).find((policy) => policy.id === policyId);
  if (!status) throw new Error('Saved token usage policy could not be reloaded.');
  return status;
}

export async function deleteUserTokenUsagePolicy(userId: string, policyId: string) {
  const { data: policy, error: lookupError } = await supabase
    .from('user_token_usage_policies')
    .select('key_source,provider_family')
    .eq('id', policyId)
    .eq('user_id', userId)
    .maybeSingle();
  if (lookupError) throw lookupError;
  const { error } = await supabase
    .from('user_token_usage_policies')
    .delete()
    .eq('id', policyId)
    .eq('user_id', userId);
  if (error) throw error;
  if (policy?.key_source === 'all' && policy?.provider_family === 'all') {
    const { error: legacyError } = await supabase.from('user_token_usage_limits').delete().eq('user_id', userId);
    if (legacyError) throw legacyError;
  }
}

export async function setUserTokenUsageLimits(
  userId: string,
  limits: UserTokenUsageLimitsInput,
  updatedBy: string,
): Promise<UserTokenUsageLimitStatus> {
  if (limits.dailyLimit === null && limits.weeklyLimit === null && limits.monthlyLimit === null) {
    const results = await Promise.all([
      supabase.from('user_token_usage_limits').delete().eq('user_id', userId),
      supabase
        .from('user_token_usage_policies')
        .delete()
        .eq('user_id', userId)
        .eq('key_source', 'all')
        .eq('provider_family', 'all'),
    ]);
    for (const result of results) if (result.error) throw result.error;
    return getTokenUsageLimitStatus(userId);
  }

  return setUserTokenUsagePolicy(userId, {
    keySource: 'all',
    providerFamily: 'all',
    dailyLimit: limits.dailyLimit,
    weeklyLimit: limits.weeklyLimit,
    monthlyLimit: limits.monthlyLimit,
    requestsPerMinute: null,
    tokensPerMinute: null,
    enabled: true,
  }, updatedBy);
}
