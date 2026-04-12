-- migration-058: persist the AI model tag used for dashboard summaries

alter table public.user_dashboard_summaries
  add column if not exists model text;
