-- Persist code-level observations so repository-aware insights survive reloads.
alter table public.project_insights
  add column if not exists code_insights jsonb not null default '[]'::jsonb;
