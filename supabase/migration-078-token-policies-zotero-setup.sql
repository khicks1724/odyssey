-- Scoped AI usage policies and a lower-friction Zotero connection flow.

alter table public.fallback_token_usage_logs
  add column if not exists provider_family text;

update public.fallback_token_usage_logs
set provider_family = case
  when lower(provider) like '%nvidia%' then 'nvidia'
  when lower(provider) like '%gemma%' then 'gemma4'
  when lower(provider) like 'openai:%' or lower(provider) = 'gpt-4o' then 'openai'
  when lower(provider) like 'claude%' then 'anthropic'
  when lower(provider) like 'genai-mil%' then 'genai_mil'
  when lower(provider) like 'gemini%' then 'google_ai'
  else 'other'
end
where provider_family is null;

alter table public.fallback_token_usage_logs
  alter column provider_family set default 'other';

alter table public.fallback_token_usage_logs
  alter column provider_family set not null;

create index if not exists idx_fallback_token_usage_logs_policy_lookup
  on public.fallback_token_usage_logs (user_id, key_source, provider_family, created_at desc);

create table if not exists public.user_token_usage_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  key_source text not null default 'all'
    check (key_source in ('all', 'server', 'user')),
  provider_family text not null default 'all'
    check (provider_family in ('all', 'openai', 'anthropic', 'google_ai', 'genai_mil', 'nvidia', 'gemma4', 'other')),
  daily_limit bigint check (daily_limit is null or daily_limit > 0),
  weekly_limit bigint check (weekly_limit is null or weekly_limit > 0),
  monthly_limit bigint check (monthly_limit is null or monthly_limit > 0),
  requests_per_minute integer check (requests_per_minute is null or requests_per_minute > 0),
  tokens_per_minute bigint check (tokens_per_minute is null or tokens_per_minute > 0),
  enabled boolean not null default true,
  revision bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_token_usage_policies_has_cap check (
    daily_limit is not null
    or weekly_limit is not null
    or monthly_limit is not null
    or requests_per_minute is not null
    or tokens_per_minute is not null
  ),
  unique (user_id, key_source, provider_family)
);

insert into public.user_token_usage_policies (
  user_id,
  key_source,
  provider_family,
  daily_limit,
  weekly_limit,
  monthly_limit,
  revision,
  updated_by,
  created_at,
  updated_at
)
select
  user_id,
  'all',
  'all',
  daily_limit,
  weekly_limit,
  monthly_limit,
  revision,
  updated_by,
  created_at,
  updated_at
from public.user_token_usage_limits
on conflict (user_id, key_source, provider_family) do nothing;

create index if not exists idx_user_token_usage_policies_user
  on public.user_token_usage_policies (user_id, enabled);

alter table public.user_token_usage_policies enable row level security;

drop policy if exists "token_usage_policies_select_own" on public.user_token_usage_policies;
create policy "token_usage_policies_select_own"
  on public.user_token_usage_policies for select
  using (user_id = auth.uid());

alter table public.zotero_oauth_requests
  add column if not exists return_path text not null default '/thesis?tab=sources';

alter table public.user_zotero_connections
  add column if not exists connection_method text not null default 'oauth'
    check (connection_method in ('oauth', 'api_key'));
