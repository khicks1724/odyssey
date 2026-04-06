#!/usr/bin/env sh
set -eu

quote_or_null() {
  if [ -n "${1:-}" ]; then
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/.*/"&"/'
  else
    printf 'null'
  fi
}

SUPABASE_URL_VALUE="$(quote_or_null "${PUBLIC_SUPABASE_URL:-}")"
SUPABASE_ANON_KEY_VALUE="$(quote_or_null "${PUBLIC_SUPABASE_ANON_KEY:-}")"

cat >/app/client-dist/odyssey-config.js <<EOF
window.__ODYSSEY_RUNTIME_CONFIG__ = {
  supabaseUrl: ${SUPABASE_URL_VALUE},
  supabaseAnonKey: ${SUPABASE_ANON_KEY_VALUE}
};
EOF

exec "$@"
