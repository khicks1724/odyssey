-- Migration 069: allow Kyle Hicks to pause shared server OpenAI fallback per user

create table if not exists public.user_server_fallback_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  server_fallback_paused boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_server_fallback_controls_updated_at
  on public.user_server_fallback_controls (updated_at desc);

alter table public.user_server_fallback_controls enable row level security;
