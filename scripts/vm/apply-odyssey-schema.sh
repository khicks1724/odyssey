#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPABASE_COMPOSE="$ROOT_DIR/deploy/supabase/docker-compose.yml"
SUPABASE_DIR="$ROOT_DIR/deploy/supabase"
TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT

run_sql() {
  local sql_file="$1"
  docker compose --env-file "$SUPABASE_DIR/.env" -f "$SUPABASE_COMPOSE" exec -T db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 <"$sql_file"
}

record_migration() {
  local migration_name="$1"
  docker compose --env-file "$SUPABASE_DIR/.env" -f "$SUPABASE_COMPOSE" exec -T db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "insert into public.odyssey_schema_migrations(name) values ('${migration_name}') on conflict (name) do nothing;" \
    >/dev/null
}

migration_applied() {
  local migration_name="$1"
  local applied
  applied="$(
    docker compose --env-file "$SUPABASE_DIR/.env" -f "$SUPABASE_COMPOSE" exec -T db \
      psql -U postgres -d postgres -tA \
      -c "select 1 from public.odyssey_schema_migrations where name = '${migration_name}' limit 1;"
  )"
  [[ "$applied" == "1" ]]
}

docker compose --env-file "$SUPABASE_DIR/.env" -f "$SUPABASE_COMPOSE" exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
create table if not exists public.odyssey_schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
SQL

SCHEMA_MARKER="schema.sql"
if migration_applied "$SCHEMA_MARKER"; then
  echo "Skipping $SCHEMA_MARKER (already recorded)"
else
  if docker compose --env-file "$SUPABASE_DIR/.env" -f "$SUPABASE_COMPOSE" exec -T db \
    psql -U postgres -d postgres -tA -c "select to_regclass('public.projects') is not null;" | grep -qx 't'; then
    echo "Skipping $SCHEMA_MARKER (core tables already exist)"
    record_migration "$SCHEMA_MARKER"
  else
    echo "Applying $SCHEMA_MARKER"
    cat "$ROOT_DIR/supabase/schema.sql" >"$TMP_SQL"
    run_sql "$TMP_SQL"
    record_migration "$SCHEMA_MARKER"
  fi
fi

for file in "$ROOT_DIR"/supabase/migration-*.sql; do
  migration_name="$(basename "$file")"
  if migration_applied "$migration_name"; then
    echo "Skipping $migration_name"
    continue
  fi

  echo "Applying $migration_name"
  cat "$file" >"$TMP_SQL"
  run_sql "$TMP_SQL"
  record_migration "$migration_name"
done

echo "Applying odyssey-bootstrap.sql"
cat "$ROOT_DIR/deploy/odyssey-bootstrap.sql" >"$TMP_SQL"
run_sql "$TMP_SQL"
