-- Migration 023: QR invite tokens with 24-hour expiry
-- Run this in the Supabase SQL Editor

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. qr_invite_tokens table
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.qr_invite_tokens (
  id          uuid        primary key default gen_random_uuid(),
  project_id  uuid        not null references public.projects(id) on delete cascade,
  token       uuid        not null unique default gen_random_uuid(),
  expires_at  timestamptz not null default (now() + interval '24 hours'),
  created_by  uuid        not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now()
);

-- Only one active token per project (old tokens stay for audit; only latest matters)
create index if not exists idx_qr_tokens_project on public.qr_invite_tokens(project_id, created_at desc);

alter table public.qr_invite_tokens enable row level security;

-- Project owners can view their tokens
drop policy if exists "qr_tokens_select" on public.qr_invite_tokens;
create policy "qr_tokens_select"
  on public.qr_invite_tokens for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.projects p
      where p.id = qr_invite_tokens.project_id
        and (
          p.owner_id = auth.uid()
          or exists (
            select 1 from public.project_members pm
            where pm.project_id = p.id and pm.user_id = auth.uid() and pm.role = 'owner'
          )
        )
    )
  );

-- Owners insert tokens via RPC (SECURITY DEFINER), not directly
drop policy if exists "qr_tokens_insert" on public.qr_invite_tokens;
create policy "qr_tokens_insert"
  on public.qr_invite_tokens for insert
  with check (created_by = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC: generate (or regenerate) a QR token for a project
--    Deletes all prior tokens for the project, then creates a fresh one.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.generate_qr_token(uuid);
create or replace function public.generate_qr_token(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_token uuid;
begin
  -- Verify caller is a project owner
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
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

  -- Invalidate (delete) all existing tokens for this project
  delete from public.qr_invite_tokens where project_id = p_project_id;

  -- Insert a fresh 24-hour token
  v_new_token := gen_random_uuid();
  insert into public.qr_invite_tokens(project_id, token, created_by)
  values (p_project_id, v_new_token, auth.uid());

  return jsonb_build_object(
    'token',      v_new_token,
    'expires_at', (now() + interval '24 hours')::text
  );
end;
$$;

grant execute on function public.generate_qr_token(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: redeem a QR token (called when user scans the code)
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.redeem_qr_token(uuid);
create or replace function public.redeem_qr_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tok    public.qr_invite_tokens;
  v_proj   public.projects;
  v_is_mem int;
begin
  -- Find the token
  select * into v_tok
  from public.qr_invite_tokens
  where token = p_token;

  if not found then
    return jsonb_build_object('error', 'Invalid or expired QR code.');
  end if;

  -- Check expiry
  if v_tok.expires_at < now() then
    delete from public.qr_invite_tokens where id = v_tok.id;
    return jsonb_build_object('error', 'This QR code has expired. Ask the owner to generate a new one.');
  end if;

  -- Find the project
  select * into v_proj from public.projects where id = v_tok.project_id;

  -- Already a member?
  select count(*) into v_is_mem
  from public.project_members
  where project_id = v_proj.id and user_id = auth.uid();

  if v_is_mem > 0 then
    return jsonb_build_object('result', 'already_member', 'project_id', v_proj.id, 'project_name', v_proj.name);
  end if;

  if v_proj.is_private then
    -- Private project → create join request
    insert into public.join_requests(project_id, user_id)
    values (v_proj.id, auth.uid())
    on conflict (project_id, user_id) do update set status = 'pending', updated_at = now();

    return jsonb_build_object('result', 'request_sent', 'project_id', v_proj.id, 'project_name', v_proj.name);
  else
    -- Public project → join directly
    insert into public.project_members(project_id, user_id, role)
    values (v_proj.id, auth.uid(), 'member')
    on conflict (project_id, user_id) do nothing;

    return jsonb_build_object('result', 'joined', 'project_id', v_proj.id, 'project_name', v_proj.name);
  end if;
end;
$$;

grant execute on function public.redeem_qr_token(uuid) to authenticated;
