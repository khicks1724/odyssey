-- Migration 061: record whether token usage came from a server fallback key or a user-provided key

alter table public.fallback_token_usage_logs
  add column if not exists key_source text;

update public.fallback_token_usage_logs
set key_source = 'server'
where key_source is null;

alter table public.fallback_token_usage_logs
  alter column key_source set default 'server';

alter table public.fallback_token_usage_logs
  alter column key_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fallback_token_usage_logs_key_source_check'
  ) then
    alter table public.fallback_token_usage_logs
      add constraint fallback_token_usage_logs_key_source_check
      check (key_source in ('server', 'user'));
  end if;
end $$;

create index if not exists idx_fallback_token_usage_logs_key_source_created_at
  on public.fallback_token_usage_logs (key_source, created_at desc);
