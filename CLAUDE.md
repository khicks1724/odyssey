# Odyssey — Claude Context

## Deployment Architecture

### Host: asterias.ssag.nps.edu (172.23.2.4)

| Port | Service | Notes |
|------|---------|-------|
| 3000 | Odyssey app (Docker) | Fastify serves React + `/api` routes |
| 3001 | Odyssey API (dev only) | tsx watch, kyle user |
| 5432 | PostgreSQL | Supabase DB (Docker) |
| 6543 | PgBouncer | Supabase connection pooler (Docker) |
| 8000 | Supabase Kong gateway | HTTP entry to all Supabase services |
| 8443 | Supabase Kong gateway | HTTPS |
| 22   | SSH | System |

### How to rebuild and restart Odyssey

Always use the `up.sh` script — do NOT run docker compose directly, it needs both compose files and the correct env:

```bash
cd /home/kyle/odyssey
bash scripts/vm/up.sh
```

### Public URL

`https://asterias.ssag.nps.edu/odyssey/`

The app is served at the `/odyssey/` subpath. The client build uses `VITE_APP_BASE_PATH=/odyssey/`.

### Remote nginx (SSL termination upstream)

SSL is terminated by a remote nginx instance. The block that proxies to this host:

```nginx
location /odyssey/ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Prefix /odyssey;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_pass http://172.23.2.4:3000/;
}
```

- `X-Forwarded-Proto https` is hardcoded (SSL terminated upstream, backend sees HTTP)
- Trailing slash on both `location` and `proxy_pass` strips the `/odyssey` prefix before forwarding
- `Upgrade`/`Connection` headers required for Supabase realtime WebSockets

### Local Supabase (Docker)

Self-hosted Supabase runs via Docker Compose. The nginx container inside Docker handles internal TLS for Supabase services on ports 80/443 (separate from the remote nginx above).

Supabase internal nginx config: `deploy/supabase/volumes/proxy/nginx/supabase-nginx.conf.tpl`

### Microsoft OAuth (Azure)

- Azure App: "Odyssey" (`b30356a7-4f39-4c12-8460-8180ba899e5f`)
- Site sign-in goes through **self-hosted Supabase Auth** OAuth, provider: `azure`
- Supabase Auth callback must match the public Odyssey URL plus `/supabase/auth/v1/callback`
- Example callback when Odyssey is hosted at `https://example.mil/odyssey`: `https://example.mil/odyssey/supabase/auth/v1/callback`
- Odyssey's separate Microsoft Graph integration flow uses `/api/microsoft/auth/callback`
- If login returns redirect mismatch or 500 `unexpected_failure`, check: Azure redirect URIs, Azure client secret expiry, local Supabase Azure provider env, Tenant URL format
- Tenant URL should be `https://login.microsoftonline.com/common` for multi-account support (or the full tenant UUID URL for org-only)
- Azure app must have "Supported account types" set to match — currently "My organization only"

### Key env files

- `server/.env` — dev server env (PORT=3001)
- `deploy/odyssey.env` — production env (used by Docker, PORT=3000)
- `client/.env.local` — client dev env (VITE_API_URL should point to 3001 for dev)
- `deploy/supabase/.env` — self-hosted Supabase secrets
