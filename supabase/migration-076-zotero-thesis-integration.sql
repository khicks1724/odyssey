-- Zotero thesis integration: normalized source records, encrypted connections,
-- incremental sync state, durable outgoing work, and field-level conflicts.

create table if not exists public.thesis_sources (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

insert into public.thesis_sources (user_id, id, data)
select
  document.user_id,
  source.value->>'id',
  source.value
from public.thesis_documents document
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(document.snapshot->'sourceLibrary') = 'array'
      then document.snapshot->'sourceLibrary'
    else '[]'::jsonb
  end
) source(value)
where nullif(btrim(source.value->>'id'), '') is not null
on conflict (user_id, id) do nothing;

create table if not exists public.user_zotero_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zotero_user_id text not null,
  zotero_username text,
  encrypted_api_key text not null,
  iv text not null,
  auth_tag text not null,
  permissions jsonb not null default '{}'::jsonb,
  selected_collection_keys text[] not null default '{}',
  sync_all boolean not null default false,
  last_library_version bigint not null default 0,
  last_fulltext_version bigint not null default 0,
  last_sync_at timestamptz,
  last_sync_status text not null default 'idle'
    check (last_sync_status in ('idle', 'syncing', 'ok', 'error', 'backoff')),
  last_sync_error text,
  backoff_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zotero_oauth_requests (
  request_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null,
  encrypted_request_secret text not null,
  iv text not null,
  auth_tag text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.thesis_zotero_item_links (
  user_id uuid not null,
  source_id text not null,
  library_type text not null default 'user' check (library_type in ('user', 'group')),
  library_id text not null,
  item_key text not null,
  item_version bigint not null default 0,
  item_type text not null default 'document',
  collection_keys text[] not null default '{}',
  baseline_data jsonb not null default '{}'::jsonb,
  sync_status text not null default 'synced'
    check (sync_status in ('synced', 'local_pending', 'remote_pending', 'conflict', 'removed_remote', 'error')),
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id),
  unique (user_id, library_type, library_id, item_key),
  foreign key (user_id, source_id)
    references public.thesis_sources(user_id, id) on delete cascade
);

create table if not exists public.zotero_sync_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text,
  operation text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, source_id)
    references public.thesis_sources(user_id, id) on delete cascade
);

create index if not exists idx_zotero_sync_outbox_available
  on public.zotero_sync_outbox (available_at, created_at);

create table if not exists public.zotero_sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id text not null,
  item_key text not null,
  fields jsonb not null,
  remote_version bigint not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, source_id)
    references public.thesis_sources(user_id, id) on delete cascade
);

create index if not exists idx_zotero_conflicts_user_unresolved
  on public.zotero_sync_conflicts (user_id, created_at desc)
  where resolved_at is null;

alter table public.thesis_sources enable row level security;
alter table public.user_zotero_connections enable row level security;
alter table public.zotero_oauth_requests enable row level security;
alter table public.thesis_zotero_item_links enable row level security;
alter table public.zotero_sync_outbox enable row level security;
alter table public.zotero_sync_conflicts enable row level security;

drop policy if exists "thesis_sources_select_own" on public.thesis_sources;
create policy "thesis_sources_select_own"
  on public.thesis_sources for select using (auth.uid() = user_id);
drop policy if exists "thesis_sources_insert_own" on public.thesis_sources;
create policy "thesis_sources_insert_own"
  on public.thesis_sources for insert with check (auth.uid() = user_id);
drop policy if exists "thesis_sources_update_own" on public.thesis_sources;
create policy "thesis_sources_update_own"
  on public.thesis_sources for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "thesis_sources_delete_own" on public.thesis_sources;
create policy "thesis_sources_delete_own"
  on public.thesis_sources for delete using (auth.uid() = user_id);

drop policy if exists "zotero_links_select_own" on public.thesis_zotero_item_links;
create policy "zotero_links_select_own"
  on public.thesis_zotero_item_links for select using (auth.uid() = user_id);
drop policy if exists "zotero_conflicts_select_own" on public.zotero_sync_conflicts;
create policy "zotero_conflicts_select_own"
  on public.zotero_sync_conflicts for select using (auth.uid() = user_id);

create or replace function public.touch_thesis_source_row()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  new.revision = old.revision + 1;
  return new;
end;
$$;

drop trigger if exists trg_touch_thesis_sources on public.thesis_sources;
create trigger trg_touch_thesis_sources
  before update on public.thesis_sources
  for each row execute function public.touch_thesis_source_row();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'user_zotero_connections',
    'thesis_zotero_item_links',
    'zotero_sync_outbox',
    'zotero_sync_conflicts'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      'trg_touch_' || table_name,
      table_name
    );
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at_generic()',
      'trg_touch_' || table_name,
      table_name
    );
  end loop;
end;
$$;

alter table public.thesis_sources replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'thesis_sources'
    )
  then
    alter publication supabase_realtime add table public.thesis_sources;
  end if;
end;
$$;
