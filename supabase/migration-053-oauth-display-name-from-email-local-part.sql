create or replace function public.handle_new_user()
returns trigger as $$
declare
  metadata_username text;
  email_local_part text;
  initial_display_name text;
begin
  metadata_username := btrim(new.raw_user_meta_data ->> 'username');
  email_local_part := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  if metadata_username is not null and not (
    metadata_username ~ '^[a-z0-9_]{3,32}$'
    or (
      char_length(metadata_username) between 10 and 64
      and metadata_username !~ '[[:cntrl:]]'
    )
  ) then
    metadata_username := null;
  end if;

  initial_display_name := coalesce(
    metadata_username,
    email_local_part,
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), '')
  );

  insert into public.profiles (id, display_name, avatar_url, email, username)
  values (
    new.id,
    initial_display_name,
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
