-- Migration 046: per-user project preferences, per-user GitLab tokens, and structured documents

create table if not exists public.project_user_preferences (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visible_tabs text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.user_project_gitlab_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  host text not null,
  token_encrypted text not null,
  token_iv text not null,
  token_auth_tag text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  event_id uuid unique references public.events(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  filename text not null,
  mime_type text,
  storage_bucket text not null,
  storage_path text not null,
  size_bytes integer not null default 0,
  readable boolean not null default false,
  extracted_text text,
  content_preview text,
  summary text,
  keywords text[] not null default '{}'::text[],
  extracted_char_count integer not null default 0,
  chunk_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.project_documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  content_preview text,
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists idx_project_user_preferences_user
  on public.project_user_preferences (user_id, project_id);

create index if not exists idx_user_project_gitlab_tokens_user
  on public.user_project_gitlab_tokens (user_id, project_id);

create index if not exists idx_project_documents_project_created
  on public.project_documents (project_id, created_at desc);

create index if not exists idx_project_document_chunks_project_document
  on public.project_document_chunks (project_id, document_id, chunk_index);

alter table public.project_user_preferences enable row level security;
alter table public.user_project_gitlab_tokens enable row level security;
alter table public.project_documents enable row level security;
alter table public.project_document_chunks enable row level security;

drop policy if exists "project_user_preferences_select_own" on public.project_user_preferences;
create policy "project_user_preferences_select_own"
  on public.project_user_preferences for select
  using (auth.uid() = user_id);

drop policy if exists "project_user_preferences_insert_own" on public.project_user_preferences;
create policy "project_user_preferences_insert_own"
  on public.project_user_preferences for insert
  with check (
    auth.uid() = user_id
    and (
      project_id in (select id from public.projects where owner_id = auth.uid())
      or project_id in (select project_id from public.project_members where user_id = auth.uid())
    )
  );

drop policy if exists "project_user_preferences_update_own" on public.project_user_preferences;
create policy "project_user_preferences_update_own"
  on public.project_user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "project_user_preferences_delete_own" on public.project_user_preferences;
create policy "project_user_preferences_delete_own"
  on public.project_user_preferences for delete
  using (auth.uid() = user_id);

drop policy if exists "user_project_gitlab_tokens_select_own" on public.user_project_gitlab_tokens;
create policy "user_project_gitlab_tokens_select_own"
  on public.user_project_gitlab_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "user_project_gitlab_tokens_insert_own" on public.user_project_gitlab_tokens;
create policy "user_project_gitlab_tokens_insert_own"
  on public.user_project_gitlab_tokens for insert
  with check (
    auth.uid() = user_id
    and (
      project_id in (select id from public.projects where owner_id = auth.uid())
      or project_id in (select project_id from public.project_members where user_id = auth.uid())
    )
  );

drop policy if exists "user_project_gitlab_tokens_update_own" on public.user_project_gitlab_tokens;
create policy "user_project_gitlab_tokens_update_own"
  on public.user_project_gitlab_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_project_gitlab_tokens_delete_own" on public.user_project_gitlab_tokens;
create policy "user_project_gitlab_tokens_delete_own"
  on public.user_project_gitlab_tokens for delete
  using (auth.uid() = user_id);

drop policy if exists "project_documents_select_members" on public.project_documents;
create policy "project_documents_select_members"
  on public.project_documents for select
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_documents_write_members" on public.project_documents;
create policy "project_documents_write_members"
  on public.project_documents for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_document_chunks_select_members" on public.project_document_chunks;
create policy "project_document_chunks_select_members"
  on public.project_document_chunks for select
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_document_chunks_write_members" on public.project_document_chunks;
create policy "project_document_chunks_write_members"
  on public.project_document_chunks for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

create or replace function public.touch_updated_at_generic()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_project_user_preferences_updated_at on public.project_user_preferences;
create trigger trg_touch_project_user_preferences_updated_at
  before update on public.project_user_preferences
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_touch_user_project_gitlab_tokens_updated_at on public.user_project_gitlab_tokens;
create trigger trg_touch_user_project_gitlab_tokens_updated_at
  before update on public.user_project_gitlab_tokens
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_touch_project_documents_updated_at on public.project_documents;
create trigger trg_touch_project_documents_updated_at
  before update on public.project_documents
  for each row
  execute function public.touch_updated_at_generic();
