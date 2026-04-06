-- migration-045: support multiple GitHub repositories per project

alter table public.projects
  add column if not exists github_repos text[] not null default '{}';

update public.projects
set github_repos = case
  when github_repo is null or btrim(github_repo) = '' then '{}'
  else array[github_repo]
end
where coalesce(array_length(github_repos, 1), 0) = 0;

create index if not exists idx_projects_github_repos
  on public.projects using gin (github_repos);
