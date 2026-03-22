-- Migration 022: Project invite codes, privacy settings, and join requests
-- Run this in the Supabase SQL Editor

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add invite_code and is_private columns to projects
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.projects
  add column if not exists invite_code text,
  add column if not exists is_private  boolean not null default false;

-- Backfill invite codes for existing projects
update public.projects
set invite_code = upper(left(replace(gen_random_uuid()::text, '-', ''), 8))
where invite_code is null;

-- Make invite_code NOT NULL and unique after backfill
alter table public.projects alter column invite_code set not null;
create unique index if not exists idx_projects_invite_code on public.projects(upper(invite_code));

-- Trigger: auto-generate invite_code on every new project insert
create or replace function public.set_invite_code()
returns trigger language plpgsql as $$
begin
  if new.invite_code is null then
    new.invite_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_invite_code on public.projects;
create trigger trg_set_invite_code
  before insert on public.projects
  for each row execute function public.set_invite_code();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. join_requests table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.join_requests (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references public.projects(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  status      text        not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique(project_id, user_id)
);

alter table public.join_requests enable row level security;

-- Users can view their own requests; project owners can view all requests for their projects
drop policy if exists "join_requests_select" on public.join_requests;
create policy "join_requests_select"
  on public.join_requests for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = join_requests.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'owner'
          )
        )
    )
  );

-- Users can create requests for themselves
drop policy if exists "join_requests_insert" on public.join_requests;
create policy "join_requests_insert"
  on public.join_requests for insert
  with check (user_id = auth.uid());

-- Project owners can approve/deny
drop policy if exists "join_requests_update" on public.join_requests;
create policy "join_requests_update"
  on public.join_requests for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = join_requests.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'owner'
          )
        )
    )
  );

-- Users can withdraw their own pending requests
drop policy if exists "join_requests_delete" on public.join_requests;
create policy "join_requests_delete"
  on public.join_requests for delete
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: join a project by invite code
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.join_project_by_code(text);
create or replace function public.join_project_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project     public.projects;
  v_is_member   int;
  v_pending_req int;
begin
  -- Look up the project (case-insensitive)
  select * into v_project
  from public.projects
  where upper(invite_code) = upper(p_code);

  if not found then
    return jsonb_build_object('error', 'Project not found. Check the invite code and try again.');
  end if;

  -- Already a member?
  select count(*) into v_is_member
  from public.project_members
  where project_id = v_project.id and user_id = auth.uid();

  if v_is_member > 0 then
    return jsonb_build_object(
      'result', 'already_member',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  end if;

  if v_project.is_private then
    -- Check for existing pending request
    select count(*) into v_pending_req
    from public.join_requests
    where project_id = v_project.id and user_id = auth.uid() and status = 'pending';

    if v_pending_req > 0 then
      return jsonb_build_object(
        'result', 'request_already_pending',
        'project_id', v_project.id,
        'project_name', v_project.name
      );
    end if;

    -- Insert or reset join request
    insert into public.join_requests(project_id, user_id)
    values (v_project.id, auth.uid())
    on conflict (project_id, user_id)
      do update set status = 'pending', updated_at = now();

    return jsonb_build_object(
      'result', 'request_sent',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  else
    -- Public project — join immediately
    insert into public.project_members(project_id, user_id, role)
    values (v_project.id, auth.uid(), 'member')
    on conflict (project_id, user_id) do nothing;

    return jsonb_build_object(
      'result', 'joined',
      'project_id', v_project.id,
      'project_name', v_project.name
    );
  end if;
end;
$$;

grant execute on function public.join_project_by_code(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RPC: owner approves or denies a join request
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.respond_join_request(uuid, text);
create or replace function public.respond_join_request(p_request_id uuid, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.join_requests;
begin
  select * into v_req from public.join_requests where id = p_request_id;

  if not found then
    return jsonb_build_object('error', 'Request not found');
  end if;

  -- Verify the caller is a project owner
  if not exists (
    select 1 from public.projects p
    where p.id = v_req.project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'owner'
        )
      )
  ) then
    return jsonb_build_object('error', 'Not authorized');
  end if;

  if p_action = 'approve' then
    insert into public.project_members(project_id, user_id, role)
    values (v_req.project_id, v_req.user_id, 'member')
    on conflict (project_id, user_id) do nothing;

    update public.join_requests
    set status = 'approved', updated_at = now()
    where id = p_request_id;

    return jsonb_build_object('result', 'approved');

  elsif p_action = 'deny' then
    update public.join_requests
    set status = 'denied', updated_at = now()
    where id = p_request_id;

    return jsonb_build_object('result', 'denied');
  else
    return jsonb_build_object('error', 'Invalid action. Use ''approve'' or ''deny''.');
  end if;
end;
$$;

grant execute on function public.respond_join_request(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Update projects RLS so owners can toggle is_private and edit invite_code
-- ─────────────────────────────────────────────────────────────────────────────
-- (Existing update policy on projects should already allow this via owner_id check.
--  No additional policy needed if migration-002 already grants owners UPDATE.)
