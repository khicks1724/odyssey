import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { supabase } from '../lib/supabase.js';

// ── Token encryption (AES-256-GCM) ──────────────────────────────────────────
// Set MICROSOFT_TOKEN_ENCRYPT_KEY to a 64-char hex string (32 random bytes).
// Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
const ENCRYPT_KEY_HEX = process.env.MICROSOFT_TOKEN_ENCRYPT_KEY ?? '';
const canEncrypt = ENCRYPT_KEY_HEX.length === 64;

function encryptToken(text: string): string {
  if (!canEncrypt) return text;
  const key = Buffer.from(ENCRYPT_KEY_HEX, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptToken(encryptedText: string): string {
  if (!canEncrypt) return encryptedText;
  const [ivHex, tagHex, dataHex] = encryptedText.split(':');
  const key = Buffer.from(ENCRYPT_KEY_HEX, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── Extract user ID from Supabase JWT ───────────────────────────────────────
async function getUserFromJWT(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return user.id;
}

// ── Microsoft OAuth configuration ────────────────────────────────────────────
const CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET ?? '';
const REDIRECT_URI =
  process.env.MICROSOFT_REDIRECT_URI ?? 'http://localhost:3001/api/microsoft/auth/callback';
const SCOPES = 'openid profile email User.Read Notes.Read Files.Read offline_access';
const MS_AUTH_BASE = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_URL = 'https://graph.microsoft.com/v1.0';

// ── HMAC-signed state parameter (binds OAuth flow to a specific user) ────────
function buildState(userId: string): string {
  const payload = `${userId}:${Date.now()}`;
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET || 'dev-fallback');
  hmac.update(payload);
  return `${payload}:${hmac.digest('hex')}`;
}

function verifyState(state: string): string | null {
  const parts = state.split(':');
  if (parts.length < 3) return null;
  const sig = parts.pop()!;
  const payload = parts.join(':');
  const hmac = crypto.createHmac('sha256', CLIENT_SECRET || 'dev-fallback');
  hmac.update(payload);
  const expected = hmac.digest('hex');
  // Timing-safe compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  // 15-minute window
  const ts = Number(parts[1]);
  if (Date.now() - ts > 15 * 60 * 1000) return null;
  return parts[0]; // userId
}

// ── Load stored token, refreshing if expired ─────────────────────────────────
async function getAccessToken(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_connections')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .single();

  if (error || !data) return null;

  const expiresAt = new Date(data.expires_at).getTime();
  if (Date.now() < expiresAt - 60_000) {
    // Still valid (60 s buffer)
    return decryptToken(data.access_token as string);
  }

  // Token expired — refresh it
  if (!data.refresh_token) return null;
  const refreshToken = decryptToken(data.refresh_token as string);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPES,
  });

  const res = await fetch(`${MS_AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) return null;

  const td = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  await supabase
    .from('user_connections')
    .update({
      access_token: encryptToken(td.access_token),
      refresh_token: td.refresh_token
        ? encryptToken(td.refresh_token)
        : data.refresh_token,
      expires_at: new Date(Date.now() + td.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('provider', 'microsoft');

  return td.access_token;
}

// ── Microsoft Graph API helpers ───────────────────────────────────────────────
async function graphGet(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${GRAPH_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function graphGetText(token: string, path: string): Promise<string> {
  const res = await fetch(`${GRAPH_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error(`Graph ${res.status}`);
  return res.text();
}

// ── Strip HTML → plain text ───────────────────────────────────────────────────
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Fastify plugin ────────────────────────────────────────────────────────────
export async function microsoftRoutes(server: FastifyInstance) {
  // ── 1. Generate OAuth URL ──────────────────────────────────────────────────
  server.get('/microsoft/auth/url', async (request, reply) => {
    const userId = await getUserFromJWT(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    if (!CLIENT_ID) {
      return reply.status(503).send({
        error: 'Microsoft integration not configured — set MICROSOFT_CLIENT_ID in server .env',
      });
    }

    const state = buildState(userId);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      response_mode: 'query',
      prompt: 'select_account',
    });

    return { url: `${MS_AUTH_BASE}/authorize?${params.toString()}` };
  });

  // ── 2. OAuth callback (browser redirect from Microsoft) ────────────────────
  server.get<{
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>('/microsoft/auth/callback', async (request, reply) => {
    const { code, state, error } = request.query;
    const clientUrl = process.env.CLIENT_URL ?? 'http://localhost:5173';

    if (error || !code || !state) {
      return reply.redirect(`${clientUrl}/settings?ms_error=${encodeURIComponent(error ?? 'missing_params')}`);
    }

    const userId = verifyState(state);
    if (!userId) {
      return reply.redirect(`${clientUrl}/settings?ms_error=invalid_state`);
    }

    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
    });

    const tokenRes = await fetch(`${MS_AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!tokenRes.ok) {
      return reply.redirect(`${clientUrl}/settings?ms_error=token_exchange_failed`);
    }

    const td = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Fetch Microsoft account info
    let msUserId = '', msEmail = '', msDisplayName = '';
    try {
      const me = (await graphGet(td.access_token, '/me?$select=id,mail,userPrincipalName,displayName')) as {
        id?: string; mail?: string; userPrincipalName?: string; displayName?: string;
      };
      msUserId = me.id ?? '';
      msEmail = me.mail ?? me.userPrincipalName ?? '';
      msDisplayName = me.displayName ?? '';
    } catch { /* non-fatal */ }

    // Upsert connection record
    const { error: dbErr } = await supabase
      .from('user_connections')
      .upsert(
        {
          user_id: userId,
          provider: 'microsoft',
          access_token: encryptToken(td.access_token),
          refresh_token: td.refresh_token ? encryptToken(td.refresh_token) : null,
          expires_at: new Date(Date.now() + td.expires_in * 1000).toISOString(),
          ms_user_id: msUserId,
          ms_email: msEmail,
          ms_display_name: msDisplayName,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,provider' },
      );

    if (dbErr) {
      server.log.error(dbErr);
      return reply.redirect(`${clientUrl}/settings?ms_error=db_error`);
    }

    return reply.redirect(`${clientUrl}/settings?ms_connected=true`);
  });

  // ── 3. Disconnect Microsoft account ───────────────────────────────────────
  server.delete('/microsoft/connection', async (request, reply) => {
    const userId = await getUserFromJWT(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    await supabase
      .from('user_connections')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'microsoft');

    return { disconnected: true };
  });

  // ── 4. Connection status ───────────────────────────────────────────────────
  server.get('/microsoft/status', async (request, reply) => {
    const userId = await getUserFromJWT(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { data } = await supabase
      .from('user_connections')
      .select('ms_email, ms_display_name, created_at')
      .eq('user_id', userId)
      .eq('provider', 'microsoft')
      .single();

    return {
      connected: !!data,
      email: data?.ms_email ?? null,
      displayName: data?.ms_display_name ?? null,
      connectedAt: data?.created_at ?? null,
    };
  });

  // ── 5. OneNote: list notebooks ─────────────────────────────────────────────
  server.get('/microsoft/onenote/notebooks', async (request, reply) => {
    const userId = await getUserFromJWT(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const token = await getAccessToken(userId);
    if (!token) return reply.status(403).send({ error: 'Microsoft account not connected or token expired. Reconnect in Settings.' });

    try {
      const data = (await graphGet(
        token,
        '/me/onenote/notebooks?$select=id,displayName,lastModifiedDateTime&$orderby=lastModifiedDateTime desc',
      )) as { value?: unknown[] };
      return { notebooks: data.value ?? [] };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      server.log.error(err);
      return reply.status(500).send({ error: msg });
    }
  });

  // ── 6. OneNote: list sections in a notebook ────────────────────────────────
  server.get<{ Params: { notebookId: string } }>(
    '/microsoft/onenote/notebooks/:notebookId/sections',
    async (request, reply) => {
      const userId = await getUserFromJWT(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const token = await getAccessToken(userId);
      if (!token) return reply.status(403).send({ error: 'Microsoft account not connected' });

      const { notebookId } = request.params;
      try {
        const data = (await graphGet(
          token,
          `/me/onenote/notebooks/${encodeURIComponent(notebookId)}/sections?$select=id,displayName,lastModifiedDateTime`,
        )) as { value?: unknown[] };
        return { sections: data.value ?? [] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── 7. OneNote: list pages in a section ────────────────────────────────────
  server.get<{ Params: { sectionId: string } }>(
    '/microsoft/onenote/sections/:sectionId/pages',
    async (request, reply) => {
      const userId = await getUserFromJWT(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const token = await getAccessToken(userId);
      if (!token) return reply.status(403).send({ error: 'Microsoft account not connected' });

      const { sectionId } = request.params;
      try {
        const data = (await graphGet(
          token,
          `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages?$select=id,title,lastModifiedDateTime&$orderby=lastModifiedDateTime desc`,
        )) as { value?: unknown[] };
        return { pages: data.value ?? [] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── 8. OneNote: get page content (HTML → plain text) ──────────────────────
  server.get<{ Params: { pageId: string } }>(
    '/microsoft/onenote/pages/:pageId/content',
    async (request, reply) => {
      const userId = await getUserFromJWT(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const token = await getAccessToken(userId);
      if (!token) return reply.status(403).send({ error: 'Microsoft account not connected' });

      const { pageId } = request.params;
      try {
        const html = await graphGetText(
          token,
          `/me/onenote/pages/${encodeURIComponent(pageId)}/content`,
        );
        return { html, text: stripHtml(html) };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── 9. OneDrive: list/search files ────────────────────────────────────────
  server.get<{ Querystring: { folderId?: string; search?: string } }>(
    '/microsoft/onedrive/files',
    async (request, reply) => {
      const userId = await getUserFromJWT(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const token = await getAccessToken(userId);
      if (!token) return reply.status(403).send({ error: 'Microsoft account not connected' });

      const { folderId, search } = request.query;
      const fields = '$select=id,name,file,folder,size,lastModifiedDateTime,webUrl';

      try {
        let path: string;
        if (search) {
          path = `/me/drive/root/search(q='${encodeURIComponent(search)}')?${fields}&$top=50`;
        } else if (folderId) {
          path = `/me/drive/items/${encodeURIComponent(folderId)}/children?${fields}&$orderby=lastModifiedDateTime desc`;
        } else {
          path = `/me/drive/root/children?${fields}&$orderby=lastModifiedDateTime desc`;
        }

        const data = (await graphGet(token, path)) as { value?: unknown[] };
        return { files: data.value ?? [] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── 10. OneDrive: get file text content ────────────────────────────────────
  server.get<{ Params: { itemId: string } }>(
    '/microsoft/onedrive/files/:itemId/content',
    async (request, reply) => {
      const userId = await getUserFromJWT(request.headers.authorization);
      if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

      const token = await getAccessToken(userId);
      if (!token) return reply.status(403).send({ error: 'Microsoft account not connected' });

      const { itemId } = request.params;
      try {
        const meta = (await graphGet(
          token,
          `/me/drive/items/${encodeURIComponent(itemId)}?$select=name,file`,
        )) as { name?: string; file?: { mimeType?: string } };

        const mimeType = meta.file?.mimeType ?? '';
        const name = meta.name ?? 'file';
        const isText =
          mimeType.startsWith('text/') ||
          name.endsWith('.txt') ||
          name.endsWith('.md') ||
          name.endsWith('.csv') ||
          name.endsWith('.json');

        let text = '';
        if (isText) {
          const res = await fetch(`${GRAPH_URL}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) text = await res.text();
        } else {
          text = `[${name}] This file type (${mimeType || 'binary'}) must be opened in Microsoft Office. Use the web URL to view it.`;
        }

        return { name, mimeType, text: text.slice(0, 50_000) };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ── 11. Import: create an Odyssey event from an Office item ───────────────
  interface ImportBody {
    projectId: string;
    source: 'onenote' | 'onedrive';
    itemId: string;
    title: string;
    webUrl?: string;
    content?: string; // pre-fetched plain text (optional, stored as preview)
  }

  server.post<{ Body: ImportBody }>('/microsoft/import', async (request, reply) => {
    const userId = await getUserFromJWT(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { projectId, source, itemId, title, webUrl, content } = request.body;
    if (!projectId || !source || !itemId || !title) {
      return reply.status(400).send({ error: 'projectId, source, itemId, and title are required' });
    }

    // Verify the user owns or is a member of the project
    const { data: proj } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .single();

    const { data: membership } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .single();

    if (proj?.owner_id !== userId && !membership) {
      return reply.status(403).send({ error: 'Not a member of this project' });
    }

    const { data, error: dbErr } = await supabase
      .from('events')
      .insert({
        project_id: projectId,
        actor_id: userId,
        source,
        event_type: source === 'onenote' ? 'note' : 'file_edit',
        title,
        summary: content ? content.slice(0, 500) : null,
        metadata: {
          ms_item_id: itemId,
          web_url: webUrl ?? null,
          content_preview: content ? content.slice(0, 2000) : null,
        },
        occurred_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (dbErr) return reply.status(500).send({ error: dbErr.message });
    return { event: data };
  });
}
