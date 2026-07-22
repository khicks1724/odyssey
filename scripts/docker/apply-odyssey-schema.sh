#!/usr/bin/env bash
set -euo pipefail

PSQL=(
  psql
  --host "${POSTGRES_HOST:-db}"
  --port "${POSTGRES_PORT:-5432}"
  --username postgres
  --dbname "${POSTGRES_DB:-postgres}"
  --no-psqlrc
  --set ON_ERROR_STOP=1
)

export PGPASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"

run_sql() {
  "${PSQL[@]}" --file "$1"
}

record_migration() {
  local migration_name="$1"
  validate_migration_name "$migration_name"
  "${PSQL[@]}" \
    --command "insert into public.odyssey_schema_migrations(name) values ('$migration_name') on conflict (name) do nothing;" \
    >/dev/null
}

migration_applied() {
  local migration_name="$1"
  local applied
  validate_migration_name "$migration_name"
  applied="$(
    "${PSQL[@]}" --tuples-only --no-align \
      --command "select 1 from public.odyssey_schema_migrations where name = '$migration_name' limit 1;"
  )"
  [[ "$applied" == "1" ]]
}

validate_migration_name() {
  local migration_name="$1"
  if [[ ! "$migration_name" =~ ^[A-Za-z0-9._-]+$ ]]; then
    echo "Invalid migration filename: $migration_name" >&2
    exit 1
  fi
}

"${PSQL[@]}" <<'SQL'
create table if not exists public.odyssey_schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

schema_marker="schema.sql"
if migration_applied "$schema_marker"; then
  echo "Skipping $schema_marker (already recorded)"
elif [[ "$("${PSQL[@]}" --tuples-only --no-align --command "select to_regclass('public.projects') is not null;")" == "t" ]]; then
  echo "Skipping $schema_marker (core tables already exist)"
  record_migration "$schema_marker"
else
  echo "Applying $schema_marker"
  run_sql /app/supabase/schema.sql
  record_migration "$schema_marker"
fi

for file in /app/supabase/migration-*.sql; do
  migration_name="$(basename "$file")"
  if migration_applied "$migration_name"; then
    echo "Skipping $migration_name"
    continue
  fi

  echo "Applying $migration_name"
  run_sql "$file"
  record_migration "$migration_name"
done

echo "Applying odyssey-bootstrap.sql"
run_sql /app/deploy/odyssey-bootstrap.sql

"${PSQL[@]}" --command "notify pgrst, 'reload schema';" >/dev/null
echo "Odyssey schema is current"
