-- Durable, per-user Zotero full-text chunks for source search and Thesis AI
-- retrieval. The source JSON keeps only a compact preview and indexing status;
-- the complete extracted text lives here so thesis snapshots stay small.

create table if not exists public.thesis_source_text_chunks (
  user_id uuid not null,
  source_id text not null,
  attachment_key text not null,
  attachment_name text not null default '',
  chunk_index integer not null check (chunk_index >= 0),
  content text not null,
  content_hash text not null,
  extraction_method text not null
    check (extraction_method in ('zotero', 'pdf', 'ocr', 'docx', 'text')),
  fulltext_version bigint,
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, source_id, attachment_key, chunk_index),
  foreign key (user_id, source_id)
    references public.thesis_sources(user_id, id) on delete cascade
);

create index if not exists idx_thesis_source_text_chunks_search
  on public.thesis_source_text_chunks using gin (search_vector);

create index if not exists idx_thesis_source_text_chunks_source
  on public.thesis_source_text_chunks (user_id, source_id, attachment_key, chunk_index);

alter table public.thesis_source_text_chunks enable row level security;

drop policy if exists "thesis_source_text_chunks_select_own" on public.thesis_source_text_chunks;
create policy "thesis_source_text_chunks_select_own"
  on public.thesis_source_text_chunks for select
  using (auth.uid() = user_id);

drop policy if exists "thesis_source_text_chunks_insert_own" on public.thesis_source_text_chunks;
create policy "thesis_source_text_chunks_insert_own"
  on public.thesis_source_text_chunks for insert
  with check (auth.uid() = user_id);

drop policy if exists "thesis_source_text_chunks_update_own" on public.thesis_source_text_chunks;
create policy "thesis_source_text_chunks_update_own"
  on public.thesis_source_text_chunks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "thesis_source_text_chunks_delete_own" on public.thesis_source_text_chunks;
create policy "thesis_source_text_chunks_delete_own"
  on public.thesis_source_text_chunks for delete
  using (auth.uid() = user_id);

drop trigger if exists trg_touch_thesis_source_text_chunks on public.thesis_source_text_chunks;
create trigger trg_touch_thesis_source_text_chunks
  before update on public.thesis_source_text_chunks
  for each row execute function public.touch_updated_at_generic();

create or replace function public.search_thesis_source_text_chunks(
  p_user_id uuid,
  p_query text,
  p_limit integer default 12,
  p_include_ai_excluded boolean default true
)
returns table (
  source_id text,
  source_title text,
  attachment_key text,
  attachment_name text,
  chunk_index integer,
  content text,
  snippet text,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', nullif(btrim(p_query), '')) as value
  ),
  ranked as (
    select
      chunk.source_id,
      coalesce(nullif(source.data->>'title', ''), 'Untitled source') as source_title,
      chunk.attachment_key,
      chunk.attachment_name,
      chunk.chunk_index,
      chunk.content,
      ts_headline(
        'english',
        chunk.content,
        query.value,
        'MaxWords=90, MinWords=35, ShortWord=2, MaxFragments=2'
      ) as snippet,
      (
        ts_rank_cd(chunk.search_vector, query.value, 32)
        + (2 * ts_rank_cd(to_tsvector('english', coalesce(source.data->>'title', '')), query.value, 32))
      )::real as rank
    from public.thesis_source_text_chunks chunk
    join public.thesis_sources source
      on source.user_id = chunk.user_id
     and source.id = chunk.source_id
    cross join query
    where chunk.user_id = p_user_id
      and query.value is not null
      and (
        chunk.search_vector @@ query.value
        or to_tsvector('english', coalesce(source.data->>'title', '')) @@ query.value
      )
      and (
        p_include_ai_excluded
        or (
          lower(coalesce(source.data->>'zoteroFulltextEnabled', 'true')) not in ('false', '0', 'no')
          and (
            lower(coalesce(source.data->>'verification', 'provisional')) <> 'restricted'
            or lower(coalesce(source.data->>'zoteroFulltextRestrictedApproved', 'false')) in ('true', '1', 'yes')
          )
          and (
            lower(coalesce(source.data->>'zoteroFulltextSensitive', 'false')) not in ('true', '1', 'yes')
            or lower(coalesce(source.data->>'zoteroFulltextSensitiveApproved', 'false')) in ('true', '1', 'yes')
          )
        )
      )
  )
  select
    ranked.source_id,
    ranked.source_title,
    ranked.attachment_key,
    ranked.attachment_name,
    ranked.chunk_index,
    ranked.content,
    ranked.snippet,
    ranked.rank
  from ranked
  order by ranked.rank desc, ranked.source_title, ranked.chunk_index
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

grant execute on function public.search_thesis_source_text_chunks(uuid, text, integer, boolean)
  to authenticated, service_role;
