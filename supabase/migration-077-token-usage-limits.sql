-- Migration 077: per-user token budgets, enforcement state, and threshold notifications

create table if not exists public.user_token_usage_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_limit bigint check (daily_limit is null or daily_limit > 0),
  weekly_limit bigint check (weekly_limit is null or weekly_limit > 0),
  monthly_limit bigint check (monthly_limit is null or monthly_limit > 0),
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_token_usage_limits_has_limit check (
    daily_limit is not null
    or weekly_limit is not null
    or monthly_limit is not null
  )
);

create table if not exists public.token_usage_limit_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null check (period in ('daily', 'weekly', 'monthly')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  threshold smallint not null check (threshold in (75, 100)),
  limit_revision bigint not null,
  usage_tokens bigint not null,
  limit_tokens bigint not null,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, period, period_start, threshold, limit_revision)
);

create index if not exists idx_token_usage_limit_alerts_user_created
  on public.token_usage_limit_alerts (user_id, created_at desc);

alter table public.user_token_usage_limits enable row level security;
alter table public.token_usage_limit_alerts enable row level security;

drop policy if exists "token_usage_limits_select_own" on public.user_token_usage_limits;
create policy "token_usage_limits_select_own"
  on public.user_token_usage_limits for select
  using (user_id = auth.uid());

drop policy if exists "token_usage_limit_alerts_select_own" on public.token_usage_limit_alerts;
create policy "token_usage_limit_alerts_select_own"
  on public.token_usage_limit_alerts for select
  using (user_id = auth.uid());

create or replace function public.maybe_create_token_usage_limit_alert(
  p_user_id uuid,
  p_period text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_limit bigint,
  p_limit_revision bigint,
  p_threshold smallint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage bigint;
  v_alert_id uuid;
  v_notification_id uuid;
  v_period_label text;
begin
  if p_limit is null or p_limit <= 0 then
    return;
  end if;

  select coalesce(sum(total_tokens), 0)::bigint
  into v_usage
  from public.fallback_token_usage_logs
  where user_id = p_user_id
    and created_at >= p_period_start
    and created_at < p_period_end;

  if (v_usage::numeric * 100) < (p_limit::numeric * p_threshold) then
    return;
  end if;

  -- If one request crosses both thresholds, the reached notification is the
  -- useful one; do not also send a stale 75% warning at the same moment.
  if p_threshold = 75 and v_usage >= p_limit then
    return;
  end if;

  insert into public.token_usage_limit_alerts (
    user_id,
    period,
    period_start,
    period_end,
    threshold,
    limit_revision,
    usage_tokens,
    limit_tokens
  ) values (
    p_user_id,
    p_period,
    p_period_start,
    p_period_end,
    p_threshold,
    p_limit_revision,
    v_usage,
    p_limit
  )
  on conflict (user_id, period, period_start, threshold, limit_revision) do nothing
  returning id into v_alert_id;

  if v_alert_id is null then
    return;
  end if;

  v_period_label := initcap(p_period);

  insert into public.notifications (
    user_id,
    kind,
    title,
    body,
    link,
    metadata
  ) values (
    p_user_id,
    case when p_threshold = 100 then 'token_limit_reached' else 'token_limit_warning' end,
    case
      when p_threshold = 100 then v_period_label || ' token limit reached'
      else v_period_label || ' token limit is 75% used'
    end,
    case
      when p_threshold = 100 then
        'You have used ' || v_usage || ' of ' || p_limit || ' tokens. New AI requests are paused while any token limit is reached. This limit resets at '
        || to_char(p_period_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || '.'
      else
        'You have used ' || v_usage || ' of ' || p_limit || ' tokens. The limit resets at '
        || to_char(p_period_end at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || '.'
    end,
    '/token-usage',
    jsonb_build_object(
      'period', p_period,
      'threshold', p_threshold,
      'usage_tokens', v_usage,
      'limit_tokens', p_limit,
      'period_start', p_period_start,
      'period_end', p_period_end,
      'limit_revision', p_limit_revision
    )
  )
  returning id into v_notification_id;

  update public.token_usage_limit_alerts
  set notification_id = v_notification_id
  where id = v_alert_id;
end;
$$;

create or replace function public.evaluate_user_token_usage_limits(
  p_user_id uuid,
  p_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limits public.user_token_usage_limits%rowtype;
  v_day_start timestamptz;
  v_week_start timestamptz;
  v_month_start timestamptz;
begin
  -- Serialize evaluations for one user. Without this lock, two concurrent AI
  -- requests can each observe usage just below a threshold and collectively
  -- cross it without either request creating the alert.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_limits
  from public.user_token_usage_limits
  where user_id = p_user_id;

  if not found then
    return;
  end if;

  -- Quota periods use UTC so their boundaries cannot move with a browser setting.
  v_day_start := date_trunc('day', p_at at time zone 'UTC') at time zone 'UTC';
  v_week_start := date_trunc('week', p_at at time zone 'UTC') at time zone 'UTC';
  v_month_start := date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC';

  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'daily', v_day_start, v_day_start + interval '1 day',
    v_limits.daily_limit, v_limits.revision, 75::smallint
  );
  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'daily', v_day_start, v_day_start + interval '1 day',
    v_limits.daily_limit, v_limits.revision, 100::smallint
  );

  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'weekly', v_week_start, v_week_start + interval '1 week',
    v_limits.weekly_limit, v_limits.revision, 75::smallint
  );
  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'weekly', v_week_start, v_week_start + interval '1 week',
    v_limits.weekly_limit, v_limits.revision, 100::smallint
  );

  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'monthly', v_month_start, v_month_start + interval '1 month',
    v_limits.monthly_limit, v_limits.revision, 75::smallint
  );
  perform public.maybe_create_token_usage_limit_alert(
    p_user_id, 'monthly', v_month_start, v_month_start + interval '1 month',
    v_limits.monthly_limit, v_limits.revision, 100::smallint
  );
end;
$$;

create or replace function public.get_user_token_usage_limit_status(
  p_user_ids uuid[],
  p_at timestamptz default now()
)
returns table (
  user_id uuid,
  daily_limit bigint,
  weekly_limit bigint,
  monthly_limit bigint,
  daily_used bigint,
  weekly_used bigint,
  monthly_used bigint,
  daily_period_start timestamptz,
  daily_period_end timestamptz,
  weekly_period_start timestamptz,
  weekly_period_end timestamptz,
  monthly_period_start timestamptz,
  monthly_period_end timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with requested_users as (
    select distinct requested_user_id as user_id
    from unnest(coalesce(p_user_ids, '{}'::uuid[])) requested_user_id
  ),
  bounds as (
    select
      date_trunc('day', p_at at time zone 'UTC') at time zone 'UTC' as day_start,
      date_trunc('week', p_at at time zone 'UTC') at time zone 'UTC' as week_start,
      date_trunc('month', p_at at time zone 'UTC') at time zone 'UTC' as month_start
  )
  select
    requested_users.user_id,
    limits.daily_limit,
    limits.weekly_limit,
    limits.monthly_limit,
    coalesce(sum(logs.total_tokens) filter (where logs.created_at >= bounds.day_start), 0)::bigint as daily_used,
    coalesce(sum(logs.total_tokens) filter (where logs.created_at >= bounds.week_start), 0)::bigint as weekly_used,
    coalesce(sum(logs.total_tokens) filter (where logs.created_at >= bounds.month_start), 0)::bigint as monthly_used,
    bounds.day_start,
    bounds.day_start + interval '1 day',
    bounds.week_start,
    bounds.week_start + interval '1 week',
    bounds.month_start,
    bounds.month_start + interval '1 month'
  from requested_users
  cross join bounds
  left join public.user_token_usage_limits limits
    on limits.user_id = requested_users.user_id
  left join public.fallback_token_usage_logs logs
    on logs.user_id = requested_users.user_id
    and logs.created_at >= least(bounds.day_start, bounds.week_start, bounds.month_start)
    and logs.created_at <= p_at
  group by
    requested_users.user_id,
    limits.daily_limit,
    limits.weekly_limit,
    limits.monthly_limit,
    bounds.day_start,
    bounds.week_start,
    bounds.month_start;
$$;

create or replace function public.notify_token_usage_limit_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.evaluate_user_token_usage_limits(new.user_id, new.created_at);
  return new;
end;
$$;

drop trigger if exists trg_notify_token_usage_limit_thresholds on public.fallback_token_usage_logs;
create trigger trg_notify_token_usage_limit_thresholds
  after insert on public.fallback_token_usage_logs
  for each row execute function public.notify_token_usage_limit_thresholds();

revoke all on function public.maybe_create_token_usage_limit_alert(uuid, text, timestamptz, timestamptz, bigint, bigint, smallint) from public, anon, authenticated;
revoke all on function public.evaluate_user_token_usage_limits(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_user_token_usage_limit_status(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function public.evaluate_user_token_usage_limits(uuid, timestamptz) to service_role;
grant execute on function public.get_user_token_usage_limit_status(uuid[], timestamptz) to service_role;
