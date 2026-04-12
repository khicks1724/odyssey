-- migration-065: persist thesis page overview state on the user's profile

alter table public.profiles
  add column if not exists thesis_page_snapshot jsonb not null default '{}'::jsonb;
