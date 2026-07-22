-- Supabase installations may grant new public functions to the API roles via
-- default privileges. The summary function is meaningful only for signed-in
-- users, so keep its execution surface explicit.

revoke all on function public.get_my_chat_thread_summaries() from public, anon;
grant execute on function public.get_my_chat_thread_summaries() to authenticated;
