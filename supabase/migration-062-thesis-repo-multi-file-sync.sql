alter table public.user_thesis_repo_links
  add column if not exists file_paths jsonb not null default '[]'::jsonb;

update public.user_thesis_repo_links
set file_paths = jsonb_build_array(
  coalesce(nullif(trim(file_path), ''), 'main.tex')
)
where case
  when jsonb_typeof(file_paths) = 'array' then jsonb_array_length(file_paths)
  else 0
end = 0;

alter table public.user_thesis_repo_links
  alter column file_path set default 'main.tex';
