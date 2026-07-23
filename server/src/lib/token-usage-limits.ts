import { supabase } from './supabase.js';

export type TokenUsageLimitPeriod = 'daily' | 'weekly' | 'monthly';

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

export interface UserTokenUsageLimitsInput {
  dailyLimit: number | null;
  weeklyLimit: number | null;
  monthlyLimit: number | null;
}

type TokenUsageLimitStatusRow = {
  user_id: string;
  daily_limit: number | string | null;
  weekly_limit: number | string | null;
  monthly_limit: number | string | null;
  daily_used: number | string | null;
  weekly_used: number | string | null;
  monthly_used: number | string | null;
  daily_period_start: string;
  daily_period_end: string;
  weekly_period_start: string;
  weekly_period_end: string;
  monthly_period_start: string;
  monthly_period_end: string;
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
    percentage: limit ? Math.round((used / limit) * 10_000) / 100 : 0,
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

function statusFromRow(row: TokenUsageLimitStatusRow): UserTokenUsageLimitStatus {
  return {
    daily: buildPeriodStatus(
      'daily',
      nullableLimit(row.daily_limit),
      toSafeNumber(row.daily_used),
      row.daily_period_start,
      row.daily_period_end,
    ),
    weekly: buildPeriodStatus(
      'weekly',
      nullableLimit(row.weekly_limit),
      toSafeNumber(row.weekly_used),
      row.weekly_period_start,
      row.weekly_period_end,
    ),
    monthly: buildPeriodStatus(
      'monthly',
      nullableLimit(row.monthly_limit),
      toSafeNumber(row.monthly_used),
      row.monthly_period_start,
      row.monthly_period_end,
    ),
  };
}

export async function getTokenUsageLimitStatusMap(
  userIds: string[],
  at = new Date(),
): Promise<Map<string, UserTokenUsageLimitStatus>> {
  const normalizedUserIds = [...new Set(userIds.map((value) => value.trim()).filter(Boolean))];
  const result = new Map<string, UserTokenUsageLimitStatus>();
  for (const userId of normalizedUserIds) result.set(userId, emptyStatus(at));
  if (normalizedUserIds.length === 0) return result;

  const { data, error } = await supabase.rpc('get_user_token_usage_limit_status', {
    p_user_ids: normalizedUserIds,
    p_at: at.toISOString(),
  });
  if (error) throw error;

  for (const row of (data ?? []) as TokenUsageLimitStatusRow[]) {
    result.set(row.user_id, statusFromRow(row));
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
  // When more than one budget is exhausted, report the one that resets last;
  // that is the point at which AI access can actually resume.
  return ([status.daily, status.weekly, status.monthly]
    .filter((entry) => entry.reached)
    .sort((left, right) => right.resetsAt.localeCompare(left.resetsAt))[0] ?? null);
}

export async function getReachedTokenUsageLimitForUser(
  userId: string,
  at = new Date(),
): Promise<TokenUsageLimitPeriodStatus | null> {
  // Most users are unlimited. Avoid aggregating their usage on every AI call;
  // the indexed limit-row lookup is enough to establish that no check is due.
  const { data, error } = await supabase
    .from('user_token_usage_limits')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return getReachedTokenUsageLimit(await getTokenUsageLimitStatus(userId, at));
}

export function buildTokenUsageLimitMessage(status: TokenUsageLimitPeriodStatus): string {
  return `Your ${status.period} token limit of ${status.limit ?? 0} tokens has been reached. AI requests will be available again after ${status.resetsAt}.`;
}

export async function setUserTokenUsageLimits(
  userId: string,
  limits: UserTokenUsageLimitsInput,
  updatedBy: string,
): Promise<UserTokenUsageLimitStatus> {
  if (limits.dailyLimit === null && limits.weeklyLimit === null && limits.monthlyLimit === null) {
    const { error } = await supabase
      .from('user_token_usage_limits')
      .delete()
      .eq('user_id', userId);
    if (error) throw error;
    return getTokenUsageLimitStatus(userId);
  }

  const [existingResult, latestAlertResult] = await Promise.all([
    supabase
      .from('user_token_usage_limits')
      .select('revision')
      .eq('user_id', userId)
      .maybeSingle(),
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

  const { error } = await supabase
    .from('user_token_usage_limits')
    .upsert({
      user_id: userId,
      daily_limit: limits.dailyLimit,
      weekly_limit: limits.weeklyLimit,
      monthly_limit: limits.monthlyLimit,
      revision: nextRevision,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) throw error;

  const evaluatedAt = new Date();
  const { error: evaluateError } = await supabase.rpc('evaluate_user_token_usage_limits', {
    p_user_id: userId,
    p_at: evaluatedAt.toISOString(),
  });
  if (evaluateError) throw evaluateError;

  return getTokenUsageLimitStatus(userId, evaluatedAt);
}
