create table if not exists public.thesis_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  draft text not null default '',
  editor_theme text,
  snapshot jsonb not null default '{}'::jsonb,
  repo_sync_status text not null default 'idle'
    check (repo_sync_status in ('idle', 'saved', 'error')),
  repo_sync_error text,
  repo_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_thesis_repo_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null
    check (provider in ('github', 'gitlab')),
  repo text not null,
  host text,
  branch text,
  file_path text not null default 'thesis/main.tex',
  autosave_enabled boolean not null default true,
  token_encrypted text,
  token_iv text,
  token_auth_tag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index if not exists idx_thesis_documents_updated
  on public.thesis_documents (updated_at desc);

create index if not exists idx_user_thesis_repo_links_user
  on public.user_thesis_repo_links (user_id, updated_at desc);

alter table public.thesis_documents enable row level security;
alter table public.user_thesis_repo_links enable row level security;

drop policy if exists "thesis_documents_select_own" on public.thesis_documents;
create policy "thesis_documents_select_own"
  on public.thesis_documents for select
  using (auth.uid() = user_id);

drop policy if exists "thesis_documents_insert_own" on public.thesis_documents;
create policy "thesis_documents_insert_own"
  on public.thesis_documents for insert
  with check (auth.uid() = user_id);

drop policy if exists "thesis_documents_update_own" on public.thesis_documents;
create policy "thesis_documents_update_own"
  on public.thesis_documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "thesis_documents_delete_own" on public.thesis_documents;
create policy "thesis_documents_delete_own"
  on public.thesis_documents for delete
  using (auth.uid() = user_id);

drop policy if exists "user_thesis_repo_links_select_own" on public.user_thesis_repo_links;
create policy "user_thesis_repo_links_select_own"
  on public.user_thesis_repo_links for select
  using (auth.uid() = user_id);

drop policy if exists "user_thesis_repo_links_insert_own" on public.user_thesis_repo_links;
create policy "user_thesis_repo_links_insert_own"
  on public.user_thesis_repo_links for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_thesis_repo_links_update_own" on public.user_thesis_repo_links;
create policy "user_thesis_repo_links_update_own"
  on public.user_thesis_repo_links for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_thesis_repo_links_delete_own" on public.user_thesis_repo_links;
create policy "user_thesis_repo_links_delete_own"
  on public.user_thesis_repo_links for delete
  using (auth.uid() = user_id);

drop trigger if exists trg_touch_thesis_documents_updated_at on public.thesis_documents;
create trigger trg_touch_thesis_documents_updated_at
  before update on public.thesis_documents
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_touch_user_thesis_repo_links_updated_at on public.user_thesis_repo_links;
create trigger trg_touch_user_thesis_repo_links_updated_at
  before update on public.user_thesis_repo_links
  for each row
  execute function public.touch_updated_at_generic();
