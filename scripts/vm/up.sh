#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -n "${ODYSSEY_HOSTNAME:-}" ]]; then
  "$ROOT_DIR/scripts/vm/generate-supabase-env.sh" "$ODYSSEY_HOSTNAME" >/dev/null
else
  "$ROOT_DIR/scripts/vm/generate-supabase-env.sh" >/dev/null
fi
docker compose \
  --env-file "$ROOT_DIR/deploy/supabase/.env" \
  -f "$ROOT_DIR/deploy/supabase/docker-compose.yml" \
  -f "$ROOT_DIR/deploy/docker-compose.odyssey.yml" \
  up -d --build
