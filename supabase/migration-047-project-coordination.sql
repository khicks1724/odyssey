-- Migration 047: derived coordination graph + per-project coordination snapshots

create table if not exists public.project_graph_nodes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  node_type text not null check (node_type in ('person', 'task', 'document', 'repo', 'file', 'concept', 'deliverable')),
  external_id text not null,
  label text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, node_type, external_id)
);

create table if not exists public.project_graph_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  edge_type text not null check (edge_type in ('owns', 'assigned_to', 'depends_on', 'mentions', 'derived_from', 'contributes_to', 'expert_in', 'blocked_by', 'collaborates_with', 'covers')),
  from_node_id uuid not null references public.project_graph_nodes(id) on delete cascade,
  to_node_id uuid not null references public.project_graph_nodes(id) on delete cascade,
  weight numeric not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, edge_type, from_node_id, to_node_id)
);

create table if not exists public.project_coordination_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  generated_by uuid references auth.users(id) on delete set null,
  snapshot jsonb not null default '{}'::jsonb,
  graph_stats jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  is_stale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_graph_nodes_project_type
  on public.project_graph_nodes (project_id, node_type);

create index if not exists idx_project_graph_edges_project_type
  on public.project_graph_edges (project_id, edge_type);

create index if not exists idx_project_graph_edges_from_to
  on public.project_graph_edges (from_node_id, to_node_id);

create index if not exists idx_project_coordination_snapshots_project
  on public.project_coordination_snapshots (project_id, generated_at desc);

alter table public.project_graph_nodes enable row level security;
alter table public.project_graph_edges enable row level security;
alter table public.project_coordination_snapshots enable row level security;

drop policy if exists "project_graph_nodes_select_members" on public.project_graph_nodes;
create policy "project_graph_nodes_select_members"
  on public.project_graph_nodes for select
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_graph_nodes_write_members" on public.project_graph_nodes;
create policy "project_graph_nodes_write_members"
  on public.project_graph_nodes for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_graph_edges_select_members" on public.project_graph_edges;
create policy "project_graph_edges_select_members"
  on public.project_graph_edges for select
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_graph_edges_write_members" on public.project_graph_edges;
create policy "project_graph_edges_write_members"
  on public.project_graph_edges for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_coordination_snapshots_select_members" on public.project_coordination_snapshots;
create policy "project_coordination_snapshots_select_members"
  on public.project_coordination_snapshots for select
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

drop policy if exists "project_coordination_snapshots_write_members" on public.project_coordination_snapshots;
create policy "project_coordination_snapshots_write_members"
  on public.project_coordination_snapshots for all
  using (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  )
  with check (
    project_id in (select id from public.projects where owner_id = auth.uid())
    or project_id in (select project_id from public.project_members where user_id = auth.uid())
  );

create or replace function public.mark_project_coordination_snapshot_stale()
returns trigger as $$
declare
  v_project_id uuid;
begin
  if tg_table_name = 'projects' then
    v_project_id := coalesce(new.id, old.id);
  else
    v_project_id := coalesce(new.project_id, old.project_id);
  end if;

  if v_project_id is not null then
    update public.project_coordination_snapshots
      set is_stale = true,
          updated_at = now()
      where project_id = v_project_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_project_graph_nodes_updated_at on public.project_graph_nodes;
create trigger trg_touch_project_graph_nodes_updated_at
  before update on public.project_graph_nodes
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_touch_project_graph_edges_updated_at on public.project_graph_edges;
create trigger trg_touch_project_graph_edges_updated_at
  before update on public.project_graph_edges
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_touch_project_coordination_snapshots_updated_at on public.project_coordination_snapshots;
create trigger trg_touch_project_coordination_snapshots_updated_at
  before update on public.project_coordination_snapshots
  for each row
  execute function public.touch_updated_at_generic();

drop trigger if exists trg_mark_coordination_stale_projects on public.projects;
create trigger trg_mark_coordination_stale_projects
  after insert or update or delete on public.projects
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_project_members on public.project_members;
create trigger trg_mark_coordination_stale_project_members
  after insert or update or delete on public.project_members
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_goals on public.goals;
create trigger trg_mark_coordination_stale_goals
  after insert or update or delete on public.goals
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_goal_dependencies on public.goal_dependencies;
create trigger trg_mark_coordination_stale_goal_dependencies
  after insert or update or delete on public.goal_dependencies
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_goal_comments on public.goal_comments;
create trigger trg_mark_coordination_stale_goal_comments
  after insert or update or delete on public.goal_comments
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_time_logs on public.time_logs;
create trigger trg_mark_coordination_stale_time_logs
  after insert or update or delete on public.time_logs
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_events on public.events;
create trigger trg_mark_coordination_stale_events
  after insert or update or delete on public.events
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_project_documents on public.project_documents;
create trigger trg_mark_coordination_stale_project_documents
  after insert or update or delete on public.project_documents
  for each row
  execute function public.mark_project_coordination_snapshot_stale();

drop trigger if exists trg_mark_coordination_stale_integrations on public.integrations;
create trigger trg_mark_coordination_stale_integrations
  after insert or update or delete on public.integrations
  for each row
  execute function public.mark_project_coordination_snapshot_stale();
