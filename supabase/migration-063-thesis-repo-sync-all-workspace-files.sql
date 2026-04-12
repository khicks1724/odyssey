alter table public.user_thesis_repo_links
  add column if not exists sync_all_workspace_files boolean not null default false;
