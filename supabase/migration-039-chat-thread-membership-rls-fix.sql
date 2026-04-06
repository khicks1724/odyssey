create or replace function public.is_chat_thread_member(p_thread_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_thread_members
    where thread_id = p_thread_id
      and user_id = p_user_id
  );
$$;

drop policy if exists "chat_threads_select_member" on public.chat_threads;
create policy "chat_threads_select_member"
  on public.chat_threads for select
  using (public.is_chat_thread_member(id, auth.uid()));

drop policy if exists "chat_threads_update_member" on public.chat_threads;
create policy "chat_threads_update_member"
  on public.chat_threads for update
  using (public.is_chat_thread_member(id, auth.uid()))
  with check (public.is_chat_thread_member(id, auth.uid()));

drop policy if exists "chat_thread_members_select_member" on public.chat_thread_members;
create policy "chat_thread_members_select_member"
  on public.chat_thread_members for select
  using (
    user_id = auth.uid()
    or public.is_chat_thread_member(thread_id, auth.uid())
  );

drop policy if exists "chat_messages_select_member" on public.chat_messages;
create policy "chat_messages_select_member"
  on public.chat_messages for select
  using (public.is_chat_thread_member(thread_id, auth.uid()));

drop policy if exists "chat_messages_insert_member" on public.chat_messages;
create policy "chat_messages_insert_member"
  on public.chat_messages for insert
  with check (
    public.is_chat_thread_member(thread_id, auth.uid())
    and (sender_id is null or sender_id = auth.uid())
  );

grant execute on function public.is_chat_thread_member(uuid, uuid) to authenticated;
