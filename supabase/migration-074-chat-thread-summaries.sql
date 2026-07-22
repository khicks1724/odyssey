-- Return the sidebar/chat-list state in one bounded request. This replaces the
-- client-side fan-out that repeatedly downloaded every message in every thread.

drop function if exists public.get_my_chat_thread_summaries();

create function public.get_my_chat_thread_summaries()
returns table (
  thread jsonb,
  participants jsonb,
  last_message jsonb,
  last_read_at timestamptz,
  hidden_at timestamptz,
  unread_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    to_jsonb(ct) as thread,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', member.user_id,
            'display_name', profile.display_name,
            'avatar_url', profile.avatar_url
          )
          order by coalesce(profile.display_name, ''), member.joined_at
        )
        from public.chat_thread_members member
        left join public.profiles profile on profile.id = member.user_id
        where member.thread_id = ct.id
      ),
      '[]'::jsonb
    ) as participants,
    (
      select jsonb_build_object(
        'id', message.id,
        'thread_id', message.thread_id,
        'sender_id', message.sender_id,
        'role', message.role,
        'content', message.content,
        'created_at', message.created_at
      )
      from public.chat_messages message
      where message.thread_id = ct.id
      order by message.created_at desc
      limit 1
    ) as last_message,
    state.last_read_at,
    state.hidden_at,
    (
      select count(*)
      from public.chat_messages unread
      where unread.thread_id = ct.id
        and unread.sender_id is distinct from auth.uid()
        and (state.last_read_at is null or unread.created_at > state.last_read_at)
    ) as unread_count
  from public.chat_thread_members mine
  join public.chat_threads ct on ct.id = mine.thread_id
  left join public.chat_thread_user_state state
    on state.thread_id = ct.id
   and state.user_id = mine.user_id
  where mine.user_id = auth.uid()
    and auth.uid() is not null
  order by ct.updated_at desc;
$$;

revoke all on function public.get_my_chat_thread_summaries() from public, anon;
grant execute on function public.get_my_chat_thread_summaries() to authenticated;
