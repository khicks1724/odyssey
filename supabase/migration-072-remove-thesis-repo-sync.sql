-- Remove the Thesis "Repository Target" / repo-mirror feature.
-- Drops the per-user repo link table and the repo-sync columns on thesis_documents.
-- The thesis_documents table itself (Odyssey cloud autosave) is retained.

drop trigger if exists trg_touch_user_thesis_repo_links_updated_at on public.user_thesis_repo_links;

drop table if exists public.user_thesis_repo_links;

alter table public.thesis_documents
  drop column if exists repo_sync_status,
  drop column if exists repo_sync_error,
  drop column if exists repo_synced_at;
