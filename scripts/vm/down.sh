#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
docker compose \
  --env-file "$ROOT_DIR/deploy/supabase/.env" \
  -f "$ROOT_DIR/deploy/supabase/docker-compose.yml" \
  -f "$ROOT_DIR/deploy/docker-compose.odyssey.yml" \
  down
