-- Migration 024: stronger editable project ID codes

create or replace function public.generate_project_invite_code()
returns text
language sql
as $$
  select upper(substr(translate(encode(gen_random_bytes(18), 'base64'), '/+=', 'XYZ'), 1, 24));
$$;

create or replace function public.normalize_project_invite_code()
returns trigger
language plpgsql
as $$
begin
  if new.invite_code is null or btrim(new.invite_code) = '' then
    new.invite_code := public.generate_project_invite_code();
  else
    new.invite_code := upper(regexp_replace(new.invite_code, '[^A-Za-z0-9]', '', 'g'));
  end if;

  if length(new.invite_code) < 20 then
    raise exception 'Project ID code must be at least 20 characters.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_invite_code on public.projects;
create trigger trg_set_invite_code
  before insert or update of invite_code on public.projects
  for each row execute function public.normalize_project_invite_code();

update public.projects
set invite_code = public.generate_project_invite_code()
where invite_code is null or length(regexp_replace(invite_code, '[^A-Za-z0-9]', '', 'g')) < 20;
