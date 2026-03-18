-- Migration 004: Add goal statuses, github_repo column, and email to profiles
-- Run this in Supabase SQL Editor

-- 1. Add 'not_started' and 'in_progress' to goals status check
alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add constraint goals_status_check
  check (status in ('not_started', 'active', 'in_progress', 'at_risk', 'complete', 'missed'));

-- 2. Add github_repo column to projects
alter table public.projects add column if not exists github_repo text;

-- 3. Add email column to profiles for member lookup
alter table public.profiles add column if not exists email text;

-- Update handle_new_user to also capture email
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email
  )
  on conflict (id) do update set
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);
  return new;
end;
$$ language plpgsql security definer;

-- Backfill email for existing users
update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

-- Allow authenticated users to search profiles by email (for member invite)
create policy "Users can search profiles"
  on public.profiles for select
  using (auth.uid() is not null);
