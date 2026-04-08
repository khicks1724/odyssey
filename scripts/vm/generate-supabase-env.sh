#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPABASE_DIR="$ROOT_DIR/deploy/supabase"
ENV_FILE="$SUPABASE_DIR/.env"
APP_ENV_FILE="$ROOT_DIR/deploy/odyssey.env"

read_env_value() {
  local file="$1"
  local key="$2"
  python3 - "$file" "$key" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
key = sys.argv[2]

if not path.exists():
    raise SystemExit(0)

for raw in path.read_text().splitlines():
    if not raw or raw.lstrip().startswith('#') or '=' not in raw:
        continue
    current_key, value = raw.split('=', 1)
    if current_key == key:
        print(value)
        break
PY
}

extract_hostname() {
  local value="$1"
  python3 - "$value" <<'PY'
from urllib.parse import urlparse
import sys

value = sys.argv[1].strip()
if not value:
    raise SystemExit(0)

parsed = urlparse(value if '://' in value else f'http://{value}')
print(parsed.hostname or '')
PY
}

should_generate_keys() {
  local env_file="$1"
  python3 - "$env_file" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
required = {
    "POSTGRES_PASSWORD",
    "JWT_SECRET",
    "ANON_KEY",
    "SERVICE_ROLE_KEY",
    "DASHBOARD_PASSWORD",
    "SECRET_KEY_BASE",
    "VAULT_ENC_KEY",
    "PG_META_CRYPTO_KEY",
    "LOGFLARE_PUBLIC_ACCESS_TOKEN",
    "LOGFLARE_PRIVATE_ACCESS_TOKEN",
    "S3_PROTOCOL_ACCESS_KEY_ID",
    "S3_PROTOCOL_ACCESS_KEY_SECRET",
}

placeholder_markers = (
    "your-",
    "this_password_is_insecure",
    "example",
)

values = {}
if path.exists():
    for raw in path.read_text().splitlines():
        if not raw or raw.lstrip().startswith('#') or '=' not in raw:
            continue
        key, value = raw.split('=', 1)
        values[key] = value.strip()

for key in required:
    value = values.get(key, "")
    if not value:
        print("yes")
        raise SystemExit(0)
    lowered = value.lower()
    if any(marker in lowered for marker in placeholder_markers):
        print("yes")
        raise SystemExit(0)

print("no")
PY
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SUPABASE_DIR/.env.example" "$ENV_FILE"
fi

HOST_VALUE="${1:-}"
FRONTEND_URL="$(read_env_value "$APP_ENV_FILE" CLIENT_URL || true)"

if [[ -z "$HOST_VALUE" && -n "$FRONTEND_URL" ]]; then
  CLIENT_HOST="$(extract_hostname "$FRONTEND_URL")"
  if [[ -n "$CLIENT_HOST" ]]; then
    HOST_VALUE="$CLIENT_HOST"
  fi
fi

if [[ -z "$HOST_VALUE" && -f "$ENV_FILE" ]]; then
  EXISTING_PUBLIC_URL="$(read_env_value "$ENV_FILE" SUPABASE_PUBLIC_URL || true)"
  EXISTING_HOST="$(extract_hostname "$EXISTING_PUBLIC_URL")"
  if [[ -n "$EXISTING_HOST" ]]; then
    HOST_VALUE="$EXISTING_HOST"
  fi
fi

HOST_VALUE="${HOST_VALUE:-localhost}"
KONG_URL="http://${HOST_VALUE}:8000"
APP_URL="http://${HOST_VALUE}:3000"
FRONTEND_URL="${FRONTEND_URL:-$APP_URL}"

if [[ "$(should_generate_keys "$ENV_FILE")" == "yes" ]]; then
  ( cd "$SUPABASE_DIR" && sh ./utils/generate-keys.sh --update-env >/dev/null )
fi

POOLER_TENANT_ID="$(read_env_value "$ENV_FILE" POOLER_TENANT_ID || true)"
POOLER_TENANT_ID="${POOLER_TENANT_ID:-$(openssl rand -hex 8)}"

python3 - "$ENV_FILE" "$KONG_URL" "$APP_URL" "$FRONTEND_URL" "$POOLER_TENANT_ID" <<'PY'
from pathlib import Path
from urllib.parse import urlparse
import sys

env_path = Path(sys.argv[1])
kong_url = sys.argv[2]
app_url = sys.argv[3]
frontend_url = sys.argv[4]
tenant_id = sys.argv[5]

def build_public_supabase_url(frontend: str, fallback: str) -> str:
    candidate = (frontend or "").strip() or fallback
    if not candidate:
        return fallback
    return f"{candidate.rstrip('/')}/supabase"

public_supabase_url = build_public_supabase_url(frontend_url, app_url)

redirect_urls = []
for candidate in [
    frontend_url,
    f"{frontend_url.rstrip('/')}/auth/callback",
    app_url,
    f"{app_url.rstrip('/')}/auth/callback",
    "http://localhost:3000",
    "http://localhost:3000/auth/callback",
    "http://localhost:5173",
    "http://localhost:5173/auth/callback",
]:
    if candidate and candidate not in redirect_urls:
        redirect_urls.append(candidate)

updates = {
    "SUPABASE_PUBLIC_URL": public_supabase_url,
    "API_EXTERNAL_URL": public_supabase_url,
    "SITE_URL": frontend_url,
    "ADDITIONAL_REDIRECT_URLS": ",".join(redirect_urls),
    "STUDIO_DEFAULT_ORGANIZATION": "Odyssey",
    "STUDIO_DEFAULT_PROJECT": "Odyssey",
    "POOLER_TENANT_ID": tenant_id,
    "ENABLE_EMAIL_AUTOCONFIRM": "true",
    "ENABLE_PHONE_SIGNUP": "false",
}

lines = env_path.read_text().splitlines()
seen = set()
result = []

for line in lines:
    if "=" not in line or line.lstrip().startswith("#"):
        result.append(line)
        continue
    key, _ = line.split("=", 1)
    if key in updates:
        result.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        result.append(line)

for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")

env_path.write_text("\n".join(result) + "\n")
PY

printf 'Wrote %s for host %s\n' "$ENV_FILE" "$HOST_VALUE"

if [[ -f "$APP_ENV_FILE" ]]; then
  python3 - "$ENV_FILE" "$APP_ENV_FILE" <<'PY'
from pathlib import Path
import sys

supabase_env = Path(sys.argv[1])
app_env = Path(sys.argv[2])

def parse_env(path: Path):
    data = {}
    for raw in path.read_text().splitlines():
        if not raw or raw.lstrip().startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        data[key] = value
    return data

supabase_values = parse_env(supabase_env)
app_values = parse_env(app_env)

updates = {}

provider_specs = [
    (
        "AZURE",
        app_values.get("MICROSOFT_CLIENT_ID", "").strip(),
        app_values.get("MICROSOFT_CLIENT_SECRET", "").strip(),
    ),
    (
        "GITHUB",
        app_values.get("GITHUB_OAUTH_CLIENT_ID", app_values.get("GITHUB_CLIENT_ID", "")).strip(),
        app_values.get("GITHUB_OAUTH_CLIENT_SECRET", app_values.get("GITHUB_SECRET", "")).strip(),
    ),
    (
        "GOOGLE",
        app_values.get("GOOGLE_OAUTH_CLIENT_ID", app_values.get("GOOGLE_CLIENT_ID", "")).strip(),
        app_values.get("GOOGLE_OAUTH_CLIENT_SECRET", app_values.get("GOOGLE_SECRET", "")).strip(),
    ),
]

for provider, client_id, client_secret in provider_specs:
    if client_id and client_secret:
        updates.update({
            f"{provider}_ENABLED": "true",
            f"{provider}_CLIENT_ID": client_id,
            f"{provider}_SECRET": client_secret,
        })

azure_url = app_values.get("MICROSOFT_TENANT_URL", "").strip()
if azure_url:
    updates["AZURE_URL"] = azure_url

lines = supabase_env.read_text().splitlines()
seen = set()
result = []

for line in lines:
    if "=" not in line or line.lstrip().startswith("#"):
        result.append(line)
        continue
    key, _ = line.split("=", 1)
    if key in updates:
        result.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        result.append(line)

for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")

supabase_env.write_text("\n".join(result) + "\n")
PY
  printf 'Synced OAuth provider settings from %s into %s\n' "$APP_ENV_FILE" "$ENV_FILE"
fi
