-- Migration 060: audit server fallback OpenAI token usage

create table if not exists public.fallback_token_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  display_name text,
  feature text not null,
  route_path text not null,
  project_id uuid references public.projects(id) on delete set null,
  provider text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_fallback_token_usage_logs_user_created_at
  on public.fallback_token_usage_logs (user_id, created_at desc);

create index if not exists idx_fallback_token_usage_logs_created_at
  on public.fallback_token_usage_logs (created_at desc);

create index if not exists idx_fallback_token_usage_logs_project
  on public.fallback_token_usage_logs (project_id, created_at desc);

alter table public.fallback_token_usage_logs enable row level security;
