create table if not exists public.goal_reports (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  content     text not null,
  status_at   text,
  progress_at integer,
  created_at  timestamptz not null default now()
);

alter table public.goal_reports enable row level security;

drop policy if exists "goal_reports_select" on public.goal_reports;
create policy "goal_reports_select" on public.goal_reports
for select using (
  exists (
    select 1
    from public.projects p
    where p.id = goal_reports.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = goal_reports.project_id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_reports_insert" on public.goal_reports;
create policy "goal_reports_insert" on public.goal_reports
for insert with check (
  exists (
    select 1
    from public.projects p
    where p.id = goal_reports.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = goal_reports.project_id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_reports_delete" on public.goal_reports;
create policy "goal_reports_delete" on public.goal_reports
for delete using (
  exists (
    select 1
    from public.projects p
    where p.id = goal_reports.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = goal_reports.project_id
            and pm.user_id = auth.uid()
        )
      )
  )
);

create index if not exists idx_goal_reports_goal_created
  on public.goal_reports(goal_id, created_at desc);

create table if not exists public.goal_attachments (
  id          uuid primary key default gen_random_uuid(),
  goal_id     uuid not null references public.goals(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  comment_id  uuid references public.goal_comments(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  file_name   text not null,
  file_path   text not null,
  file_size   bigint,
  mime_type   text,
  extracted_text text,
  content_preview text,
  document_summary text,
  extracted_char_count integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.goal_attachments enable row level security;

drop policy if exists "goal_attachments_select" on public.goal_attachments;
create policy "goal_attachments_select" on public.goal_attachments
for select using (
  exists (
    select 1
    from public.projects p
    where p.id = goal_attachments.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = goal_attachments.project_id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_attachments_insert" on public.goal_attachments;
create policy "goal_attachments_insert" on public.goal_attachments
for insert with check (
  exists (
    select 1
    from public.projects p
    where p.id = goal_attachments.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = goal_attachments.project_id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_attachments_delete" on public.goal_attachments;
create policy "goal_attachments_delete" on public.goal_attachments
for delete using (
  author_id = auth.uid()
  or exists (
    select 1
    from public.projects p
    where p.id = goal_attachments.project_id
      and p.owner_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('goal-attachments', 'goal-attachments', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "goal_attachments_storage_insert" on storage.objects;
create policy "goal_attachments_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'goal-attachments'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name, '/', 1)
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_attachments_storage_select" on storage.objects;
create policy "goal_attachments_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'goal-attachments'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name, '/', 1)
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  )
);

drop policy if exists "goal_attachments_storage_delete" on storage.objects;
create policy "goal_attachments_storage_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'goal-attachments'
  and exists (
    select 1
    from public.projects p
    where p.id::text = split_part(name, '/', 1)
      and p.owner_id = auth.uid()
  )
);

insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', true)
on conflict (id) do nothing;

drop policy if exists "project_assets_storage_insert" on storage.objects;
create policy "project_assets_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-assets'
  and split_part(name, '/', 1) = 'project-images'
  and exists (
    select 1
    from public.project_members pm
    where pm.project_id::text = split_part(name, '/', 2)
      and pm.user_id = auth.uid()
  )
);

drop policy if exists "project_assets_storage_select" on storage.objects;
create policy "project_assets_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'project-assets'
  and (
    split_part(name, '/', 1) <> 'project-images'
    or exists (
      select 1
      from public.project_members pm
      where pm.project_id::text = split_part(name, '/', 2)
        and pm.user_id = auth.uid()
    )
  )
);

drop policy if exists "project_assets_storage_delete" on storage.objects;
create policy "project_assets_storage_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-assets'
  and split_part(name, '/', 1) = 'project-images'
  and exists (
    select 1
    from public.project_members pm
    where pm.project_id::text = split_part(name, '/', 2)
      and pm.user_id = auth.uid()
  )
);
