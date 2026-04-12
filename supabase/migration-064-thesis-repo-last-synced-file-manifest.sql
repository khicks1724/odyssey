alter table public.user_thesis_repo_links
  add column if not exists last_synced_file_paths jsonb not null default '[]'::jsonb;
