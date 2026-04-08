# Odyssey VM Migration

This keeps Odyssey on a Supabase-compatible backend so the UI, auth model, storage, realtime, RPCs, and row-level-security behavior stay aligned with the existing app.

## 1. Prepare env files

Generate a self-hosted Supabase `.env` for this VM:

```bash
./scripts/vm/generate-supabase-env.sh YOUR_VM_IP_OR_HOSTNAME
```

Create the app env:

```bash
cp deploy/odyssey.env.example deploy/odyssey.env
```

Populate `deploy/odyssey.env` with the same provider and integration values currently used in `server/.env`.

`./scripts/vm/up.sh` now keeps self-hosted Supabase secrets stable after the first initialization. It updates host URLs and redirect allow-lists, but it no longer rotates JWT/API/database secrets on every restart.

If `deploy/odyssey.env` contains provider credentials, `./scripts/vm/up.sh` mirrors them into self-hosted Supabase Auth automatically:

```dotenv
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_URL=https://login.microsoftonline.com/common
```

## 2. Start the VM stack

```bash
./scripts/vm/up.sh
```

For Microsoft, register both of these redirect URIs in the same Microsoft Entra app:

- `http://YOUR_VM_IP_OR_HOSTNAME:3000/supabase/auth/v1/callback`
- `http://YOUR_VM_IP_OR_HOSTNAME:3000/api/microsoft/auth/callback`

If you publish Odyssey behind a public origin or sub-path, use that public URL instead of the raw VM port. For example:

- `https://example.mil/odyssey/supabase/auth/v1/callback`
- `https://example.mil/odyssey/api/microsoft/auth/callback`

Supabase still runs locally on the VM, but its public OAuth callback should follow the same public Odyssey URL and append `/supabase`.

## 3. Apply Odyssey schema and buckets

```bash
./scripts/vm/apply-odyssey-schema.sh
```

This applies:

- `supabase/schema.sql`
- every checked-in migration in numeric order
- `deploy/odyssey-bootstrap.sql` for the live-only pieces currently used by the app:
  - `goal_reports`
  - `goal_attachments`
  - `goal-attachments` bucket
  - `project-assets` bucket

## 4. Export the current cloud project

```bash
node scripts/vm/export-supabase-project.cjs export/current-cloud server/.env
```

This exports:

- auth user records reachable through the service-role admin API
- all app tables used by Odyssey
- storage buckets and object contents

## 5. Import into the VM-hosted Supabase stack

```bash
node scripts/vm/import-supabase-project.cjs export/current-cloud deploy/supabase/.env
```

After import, review:

```bash
cat export/current-cloud/import-auth-report.json
```

That report now includes:

- `temporaryPasswords`: users recreated without an exported password hash
- `providerIdentities`: OAuth identities that the API-based import cannot fully recreate

If `providerIdentities` is not empty and you need exact GitHub/Google/Microsoft social-login continuity, use a direct Postgres auth migration for `auth.users` and `auth.identities` instead of relying only on the service-role admin API.

## 6. Validate

Check:

- `http://YOUR_VM_IP_OR_HOSTNAME:3000/api/health`
- login flow
- existing projects, goals, chat history, reports, and uploaded files
- GitHub/GitLab/Microsoft integrations
- project image uploads
- QR invites and join flows

## Notes

- The client now supports runtime Supabase config through `client/public/odyssey-config.js`, which the production container rewrites at startup. This avoids rebuilding the frontend when the VM hostname changes.
- The repo already had unrelated local edits in several frontend files. The migration changes avoid those files except for `client/index.html`, `client/src/lib/supabase.ts`, and `client/src/vite-env.d.ts`.
