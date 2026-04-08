-- Migration 045: allow modern usernames while keeping legacy usernames valid

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  add constraint profiles_username_format
  check (
    username is null
    or username ~ '^[a-z0-9_]{3,32}$'
    or (
      char_length(btrim(username)) between 10 and 64
      and username !~ '[[:cntrl:]]'
    )
  );

drop index if exists profiles_username_lower_unique_idx;
create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(btrim(username)))
  where username is not null;

create or replace function public.handle_new_user()
returns trigger as $$
declare
  metadata_username text;
begin
  metadata_username := btrim(new.raw_user_meta_data ->> 'username');

  if metadata_username is not null and not (
    metadata_username ~ '^[a-z0-9_]{3,32}$'
    or (
      char_length(metadata_username) between 10 and 64
      and metadata_username !~ '[[:cntrl:]]'
    )
  ) then
    metadata_username := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url, email, username)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      metadata_username
    ),
    new.raw_user_meta_data ->> 'avatar_url',
    new.email,
    metadata_username
  )
  on conflict (id) do update set
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    username = coalesce(profiles.username, excluded.username),
    display_name = coalesce(profiles.display_name, excluded.display_name);

  return new;
end;
$$ language plpgsql security definer;
