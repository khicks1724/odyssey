create or replace function public.goal_assignment_ids(
  p_assigned_to uuid,
  p_assignees text[]
)
returns uuid[]
language sql
immutable
as $$
  select coalesce(
    array_agg(distinct parsed.user_id),
    '{}'::uuid[]
  )
  from (
    select p_assigned_to as user_id
    where p_assigned_to is not null

    union

    select value::uuid as user_id
    from unnest(coalesce(p_assignees, '{}'::text[])) as value
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) as parsed;
$$;

create or replace function public.notify_goal_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_assignees uuid[] := case
    when tg_op = 'UPDATE' then public.goal_assignment_ids(old.assigned_to, old.assignees)
    else '{}'::uuid[]
  end;
  v_new_assignees uuid[] := public.goal_assignment_ids(new.assigned_to, new.assignees);
  v_newly_assigned uuid[];
  v_project_name text;
  v_actor_id uuid;
  v_actor_name text;
  v_deadline_text text;
  v_category_text text;
  v_user_id uuid;
begin
  v_newly_assigned := array(
    select assignee_id
    from unnest(v_new_assignees) as assignee_id
    where not (assignee_id = any(v_old_assignees))
  );

  if coalesce(array_length(v_newly_assigned, 1), 0) = 0 then
    return new;
  end if;

  select name into v_project_name
  from public.projects
  where id = new.project_id;

  v_actor_id := coalesce(new.updated_by, new.created_by, auth.uid());

  if v_actor_id is not null then
    select coalesce(nullif(trim(display_name), ''), nullif(trim(username), ''), nullif(trim(email), ''), 'A project member')
      into v_actor_name
    from public.profiles
    where id = v_actor_id;
  end if;

  v_actor_name := coalesce(v_actor_name, 'Project AI');
  v_deadline_text := case when new.deadline is not null then to_char(new.deadline, 'YYYY-MM-DD') else null end;
  v_category_text := nullif(trim(coalesce(new.category, '')), '');

  foreach v_user_id in array v_newly_assigned loop
    perform public.create_notification(
      v_user_id,
      'task_assigned',
      'Task assigned',
      v_actor_name || ' assigned you to "' || coalesce(new.title, 'Untitled task') || '"'
        || case when v_project_name is not null then ' in "' || v_project_name || '"' else '' end
        || '.'
        || case when v_deadline_text is not null then ' Deadline: ' || v_deadline_text || '.' else '' end
        || case when v_category_text is not null then ' Category: ' || v_category_text || '.' else '' end,
      '/projects/' || new.project_id,
      new.project_id,
      v_actor_id,
      jsonb_build_object(
        'goal_id', new.id,
        'goal_title', new.title,
        'assigned_by', v_actor_name,
        'assigned_by_user_id', v_actor_id,
        'deadline', new.deadline,
        'category', new.category,
        'status', new.status,
        'progress', new.progress
      )
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_notify_goal_assignment on public.goals;
create trigger trg_notify_goal_assignment
  after insert or update on public.goals
  for each row
  execute function public.notify_goal_assignment();
