create or replace function public.remove_project_member_from_goal_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.goals as g
  set
    assignees = cleaned.filtered_assignees,
    assigned_to = case
      when g.assigned_to = old.user_id then cleaned.filtered_assignees[1]::uuid
      when g.assigned_to is not null and g.assigned_to::text = any(cleaned.filtered_assignees) then g.assigned_to
      else cleaned.filtered_assignees[1]::uuid
    end
  from (
    select
      goal.id,
      coalesce(
        array_remove(
          coalesce(
            goal.assignees,
            case
              when goal.assigned_to is not null then array[goal.assigned_to::text]
              else '{}'::text[]
            end
          ),
          old.user_id::text
        ),
        '{}'::text[]
      ) as filtered_assignees
    from public.goals as goal
    where goal.project_id = old.project_id
      and (
        goal.assigned_to = old.user_id
        or coalesce(goal.assignees, '{}'::text[]) @> array[old.user_id::text]
      )
  ) as cleaned
  where g.id = cleaned.id;

  return old;
end;
$$;

drop trigger if exists trg_remove_project_member_from_goal_assignments on public.project_members;
create trigger trg_remove_project_member_from_goal_assignments
  after delete on public.project_members
  for each row
  execute function public.remove_project_member_from_goal_assignments();
