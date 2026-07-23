import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getUserFromAuthHeader } from '../lib/request-auth.js';
import { supabase } from '../lib/supabase.js';
import {
  buildZoteroAuthorizeUrl,
  buildZoteroClientRedirect,
  decryptZoteroSecret,
  downloadZoteroFile,
  encryptZoteroSecret,
  exchangeZoteroOAuthToken,
  hashZoteroState,
  isZoteroOAuthConfigured,
  publicZoteroCallbackUrl,
  requestZoteroOAuthToken,
  safeZoteroFilename,
  validateZoteroApiKey,
  ZoteroApiError,
  zoteroJson,
  zoteroRequest,
} from '../lib/zotero-client.js';
import {
  exportThesisSourceToZotero,
  getZoteroConnection,
  getZoteroItemChildren,
  importZoteroItems,
  listThesisSources,
  listZoteroConflicts,
  performZoteroSync,
  resolveZoteroConflict,
  saveThesisSourceRecord,
  unlinkZoteroSource,
  type ZoteroApiItem,
  type ZoteroCollection,
} from '../lib/zotero-sync.js';

const MAX_ZOTERO_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const THESIS_SOURCE_BUCKET = 'project-documents';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

async function requireUser(authorization: string | undefined, reply: FastifyReply) {
  const userId = await getUserFromAuthHeader(authorization);
  if (!userId) {
    reply.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  return userId;
}

function sendZoteroError(reply: FastifyReply, error: unknown) {
  if (error instanceof ZoteroApiError) {
    const status = [400, 401, 403, 404, 409, 412, 413, 428, 429].includes(error.status)
      ? error.status
      : 502;
    return reply.status(status).send({
      error: error.message || 'Zotero request failed.',
      retryAfter: error.retryAfterSeconds,
    });
  }
  return reply.status(500).send({ error: error instanceof Error ? error.message : 'Zotero request failed.' });
}

async function getSourceLink(userId: string, sourceId: string) {
  const { data, error } = await supabase
    .from('thesis_zotero_item_links')
    .select('*')
    .eq('user_id', userId)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchAllCollections(userId: string) {
  const connection = await getZoteroConnection(userId);
  if (!connection) throw new Error('Zotero is not connected');
  const collections: ZoteroCollection[] = [];
  let start = 0;
  let total = Number.POSITIVE_INFINITY;
  while (start < total) {
    const result = await zoteroJson<ZoteroCollection[]>(
      connection.apiKey,
      `/users/${encodeURIComponent(connection.zoteroUserId)}/collections?limit=100&start=${start}&sort=title&direction=asc`,
    );
    collections.push(...result.data);
    total = result.totalResults ?? collections.length;
    if (result.data.length === 0) break;
    start += result.data.length;
  }
  return collections;
}

function connectionStatusPayload(connection: Awaited<ReturnType<typeof getZoteroConnection>>, conflictCount = 0) {
  if (!connection) {
    return { configured: isZoteroOAuthConfigured(), connected: false, conflictCount };
  }
  return {
    configured: isZoteroOAuthConfigured(),
    connected: true,
    zoteroUserId: connection.zoteroUserId,
    username: connection.username,
    permissions: connection.permissions,
    selectedCollectionKeys: connection.selectedCollectionKeys,
    syncAll: connection.syncAll,
    lastLibraryVersion: connection.lastLibraryVersion,
    lastSyncAt: connection.lastSyncAt,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncError: connection.lastSyncError,
    backoffUntil: connection.backoffUntil,
    conflictCount,
  };
}

export async function zoteroRoutes(server: FastifyInstance) {
  server.get('/zotero/status', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const [connection, conflicts] = await Promise.all([
        getZoteroConnection(userId),
        listZoteroConflicts(userId),
      ]);
      return connectionStatusPayload(connection, conflicts.length);
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post('/zotero/auth/start', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    if (!isZoteroOAuthConfigured()) {
      return reply.status(503).send({ error: 'Zotero OAuth is not configured on this Odyssey server.' });
    }
    try {
      await supabase.from('zotero_oauth_requests').delete().lt('expires_at', new Date().toISOString());
      const state = randomBytes(24).toString('base64url');
      const callbackUrl = publicZoteroCallbackUrl(state);
      const token = await requestZoteroOAuthToken(callbackUrl);
      const encrypted = encryptZoteroSecret(token.oauthTokenSecret);
      const { error } = await supabase.from('zotero_oauth_requests').insert({
        request_token: token.oauthToken,
        user_id: userId,
        state_hash: hashZoteroState(state),
        encrypted_request_secret: encrypted.encrypted,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) throw error;
      return { url: buildZoteroAuthorizeUrl(token.oauthToken) };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get<{
    Querystring: { oauth_token?: string; oauth_verifier?: string; state?: string; denied?: string };
  }>('/zotero/auth/callback', async (request, reply) => {
    const { oauth_token: requestToken, oauth_verifier: verifier, state, denied } = request.query;
    const fail = (reason: string) => reply.redirect(buildZoteroClientRedirect('settings', { zotero_error: reason }));
    if (denied) return fail('authorization_denied');
    if (!requestToken || !verifier || !state) return fail('missing_callback_parameters');
    try {
      const { data: pending, error } = await supabase
        .from('zotero_oauth_requests')
        .select('*')
        .eq('request_token', requestToken)
        .maybeSingle();
      if (error) throw error;
      if (!pending || new Date(pending.expires_at).getTime() <= Date.now()) return fail('expired_oauth_request');
      const receivedHash = Buffer.from(hashZoteroState(state));
      const expectedHash = Buffer.from(String(pending.state_hash));
      if (receivedHash.length !== expectedHash.length || !timingSafeEqual(receivedHash, expectedHash)) {
        return fail('invalid_oauth_state');
      }
      const requestSecret = decryptZoteroSecret({
        encrypted: pending.encrypted_request_secret,
        iv: pending.iv,
        authTag: pending.auth_tag,
      });
      const access = await exchangeZoteroOAuthToken({ requestToken, requestSecret, verifier });
      const validation = await validateZoteroApiKey(access.oauthTokenSecret);
      const validationData = asObject(validation.data);
      const zoteroUserId = access.userId || stringValue(validationData.userID);
      if (!zoteroUserId) throw new Error('Zotero did not return a user ID.');
      const encrypted = encryptZoteroSecret(access.oauthTokenSecret);
      const { error: upsertError } = await supabase.from('user_zotero_connections').upsert({
        user_id: pending.user_id,
        zotero_user_id: zoteroUserId,
        zotero_username: access.username || stringValue(validationData.username) || null,
        encrypted_api_key: encrypted.encrypted,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        permissions: validationData,
        last_sync_status: 'idle',
        last_sync_error: null,
        backoff_until: null,
      }, { onConflict: 'user_id' });
      if (upsertError) throw upsertError;
      await supabase.from('zotero_oauth_requests').delete().eq('request_token', requestToken);
      return reply.redirect(buildZoteroClientRedirect('settings', { zotero_connected: 'true' }));
    } catch (error) {
      request.log.warn({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Zotero OAuth callback failed');
      return fail('token_exchange_failed');
    }
  });

  server.delete('/zotero/connection', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    const connection = await getZoteroConnection(userId);
    const cleanup = await Promise.all([
      supabase.from('zotero_sync_conflicts').delete().eq('user_id', userId),
      supabase.from('zotero_sync_outbox').delete().eq('user_id', userId),
      supabase.from('thesis_zotero_item_links').delete().eq('user_id', userId),
    ]);
    const cleanupError = cleanup.find((result) => result.error)?.error;
    if (cleanupError) return reply.status(500).send({ error: 'Failed to unlink Zotero sources.' });
    const { error } = await supabase.from('user_zotero_connections').delete().eq('user_id', userId);
    if (error) return reply.status(500).send({ error: 'Failed to disconnect Zotero.' });
    if (connection) {
      await zoteroRequest(connection.apiKey, `/keys/${encodeURIComponent(connection.apiKey)}`, { method: 'DELETE' }).catch(() => undefined);
    }
    return { disconnected: true, retainedSources: true };
  });

  server.get('/zotero/collections', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return { collections: await fetchAllCollections(userId) };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get<{
    Querystring: { q?: string; collectionKey?: string; start?: string; limit?: string; style?: string; tag?: string; itemType?: string };
  }>('/zotero/items', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      if (!connection) return reply.status(403).send({ error: 'Zotero is not connected.' });
      const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit ?? '50', 10) || 50));
      const start = Math.max(0, Number.parseInt(request.query.start ?? '0', 10) || 0);
      const path = request.query.collectionKey
        ? `/users/${encodeURIComponent(connection.zoteroUserId)}/collections/${encodeURIComponent(request.query.collectionKey)}/items/top`
        : `/users/${encodeURIComponent(connection.zoteroUserId)}/items/top`;
      const params = new URLSearchParams({
        limit: String(limit),
        start: String(start),
        sort: 'dateModified',
        direction: 'desc',
        include: 'data,bib,citation',
        style: request.query.style || 'apa',
      });
      if (request.query.q?.trim()) {
        params.set('q', request.query.q.trim());
        params.set('qmode', 'everything');
      }
      if (request.query.tag?.trim()) params.set('tag', request.query.tag.trim());
      if (request.query.itemType?.trim()) params.set('itemType', request.query.itemType.trim());
      const result = await zoteroJson<ZoteroApiItem[]>(connection.apiKey, `${path}?${params.toString()}`);
      return {
        items: result.data,
        total: result.totalResults ?? result.data.length,
        start,
        limit,
        libraryVersion: result.libraryVersion,
      };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get<{ Params: { itemKey: string } }>('/zotero/items/:itemKey/children', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return await getZoteroItemChildren(userId, request.params.itemKey);
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get<{ Params: { itemKey: string } }>('/zotero/items/:itemKey/fulltext', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      if (!connection) return reply.status(403).send({ error: 'Zotero is not connected.' });
      const result = await zoteroJson<Record<string, unknown>>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(request.params.itemKey)}/fulltext`,
      );
      return { ...result.data, version: result.libraryVersion };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get<{
    Querystring: { itemKeys?: string; format?: string };
  }>('/zotero/export', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    const allowed = new Set(['bibtex', 'biblatex', 'ris', 'csljson']);
    const format = request.query.format || 'bibtex';
    const itemKeys = (request.query.itemKeys ?? '').split(',').map((key) => key.trim()).filter(Boolean).slice(0, 50);
    if (!allowed.has(format) || itemKeys.length === 0) return reply.status(400).send({ error: 'Valid itemKeys and format are required.' });
    try {
      const connection = await getZoteroConnection(userId);
      if (!connection) return reply.status(403).send({ error: 'Zotero is not connected.' });
      const params = new URLSearchParams({ itemKey: itemKeys.join(','), format });
      const response = await zoteroRequest(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items?${params.toString()}`,
        { headers: { Accept: '*/*' } },
      );
      reply.header('Content-Type', response.headers.get('Content-Type') ?? 'text/plain; charset=utf-8');
      return reply.send(await response.text());
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Body: { itemKeys?: string[]; selectedCollectionKeys?: string[]; syncAll?: boolean };
  }>('/zotero/import', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    const itemKeys = safeArray(request.body?.itemKeys).map(stringValue).filter(Boolean).slice(0, 200);
    if (itemKeys.length === 0) return reply.status(400).send({ error: 'Select at least one Zotero item.' });
    try {
      const sources = await importZoteroItems(userId, itemKeys);
      if (request.body.selectedCollectionKeys || typeof request.body.syncAll === 'boolean') {
        await supabase.from('user_zotero_connections').update({
          selected_collection_keys: safeArray(request.body.selectedCollectionKeys).map(stringValue).filter(Boolean),
          sync_all: Boolean(request.body.syncAll),
          last_library_version: 0,
        }).eq('user_id', userId);
      }
      return { ok: true, sources };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Body: { selectedCollectionKeys?: string[]; syncAll?: boolean };
  }>('/zotero/sync', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return await performZoteroSync(userId, {
        refreshCitations: true,
        ...(request.body?.selectedCollectionKeys ? {
          selectedCollectionKeys: request.body.selectedCollectionKeys.map(stringValue).filter(Boolean),
        } : {}),
        ...(typeof request.body?.syncAll === 'boolean' ? { syncAll: request.body.syncAll } : {}),
      });
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.get('/zotero/conflicts', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return { conflicts: await listZoteroConflicts(userId) };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Params: { conflictId: string };
    Body: { resolutions?: Record<string, 'local' | 'remote' | { value: unknown }> };
  }>('/zotero/conflicts/:conflictId/resolve', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return await resolveZoteroConflict(userId, request.params.conflictId, request.body?.resolutions ?? {});
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{ Params: { sourceId: string } }>('/zotero/sources/:sourceId/export', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return { source: await exportThesisSourceToZotero(userId, request.params.sourceId) };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.delete<{ Params: { sourceId: string } }>('/zotero/sources/:sourceId/link', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      return { source: await unlinkZoteroSource(userId, request.params.sourceId) };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.delete<{
    Params: { sourceId: string };
    Body: { confirmTitle?: string };
  }>('/zotero/sources/:sourceId/remote', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      const link = await getSourceLink(userId, request.params.sourceId);
      const source = (await listThesisSources(userId)).find((item) => item.id === request.params.sourceId);
      if (!connection || !link || !source) return reply.status(404).send({ error: 'Linked Zotero source not found.' });
      if (request.body?.confirmTitle !== source.title) return reply.status(400).send({ error: 'Type the exact source title to delete it from Zotero.' });
      await zoteroRequest(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(link.item_key)}`,
        { method: 'DELETE', headers: { 'If-Unmodified-Since-Version': String(link.item_version) } },
      );
      await unlinkZoteroSource(userId, request.params.sourceId);
      return { deletedFromZotero: true, retainedInOdyssey: true };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Params: { sourceId: string };
    Body: { html?: string; noteKey?: string; version?: number };
  }>('/zotero/sources/:sourceId/notes', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    const html = stringValue(request.body?.html);
    if (!html) return reply.status(400).send({ error: 'Note text is required.' });
    try {
      const connection = await getZoteroConnection(userId);
      const link = await getSourceLink(userId, request.params.sourceId);
      if (!connection || !link) return reply.status(404).send({ error: 'Linked Zotero source not found.' });
      if (request.body.noteKey) {
        await zoteroJson<null>(
          connection.apiKey,
          `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(request.body.noteKey)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'If-Unmodified-Since-Version': String(request.body.version ?? 0),
            },
            body: JSON.stringify({ note: html }),
          },
        );
      } else {
        const template = await zoteroJson<Record<string, unknown>>(connection.apiKey, '/items/new?itemType=note');
        await zoteroJson(connection.apiKey, `/users/${encodeURIComponent(connection.zoteroUserId)}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': randomBytes(16).toString('hex') },
          body: JSON.stringify([{ ...template.data, itemType: 'note', parentItem: link.item_key, note: html }]),
        });
      }
      const sync = await performZoteroSync(userId, { forceItemKeys: [link.item_key] });
      return { ok: true, sources: sync.sources };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.delete<{
    Params: { sourceId: string; noteKey: string };
    Querystring: { version?: string };
  }>('/zotero/sources/:sourceId/notes/:noteKey', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      const link = await getSourceLink(userId, request.params.sourceId);
      if (!connection || !link) return reply.status(404).send({ error: 'Linked Zotero source not found.' });
      await zoteroRequest(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(request.params.noteKey)}`,
        { method: 'DELETE', headers: { 'If-Unmodified-Since-Version': request.query.version ?? '0' } },
      );
      const sync = await performZoteroSync(userId, { forceItemKeys: [link.item_key] });
      return { ok: true, sources: sync.sources };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Params: { sourceId: string; attachmentKey: string };
    Body: { confirmedRestricted?: boolean };
  }>('/zotero/sources/:sourceId/attachments/:attachmentKey/import', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      const source = (await listThesisSources(userId)).find((item) => item.id === request.params.sourceId);
      if (!connection || !source) return reply.status(404).send({ error: 'Linked Zotero source not found.' });
      if (source.verification === 'restricted' && !request.body?.confirmedRestricted) {
        return reply.status(409).send({ error: 'Confirm that this restricted source may be copied into Odyssey.', confirmationRequired: true });
      }
      const metadata = await zoteroJson<ZoteroApiItem>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(request.params.attachmentKey)}`,
      );
      const response = await downloadZoteroFile(connection.apiKey, connection.zoteroUserId, request.params.attachmentKey);
      const declaredSize = Number(response.headers.get('Content-Length') ?? 0);
      if (declaredSize > MAX_ZOTERO_ATTACHMENT_BYTES) return reply.status(413).send({ error: 'Zotero attachment exceeds the 32 MB Odyssey limit.' });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > MAX_ZOTERO_ATTACHMENT_BYTES) return reply.status(413).send({ error: 'Zotero attachment exceeds the 32 MB Odyssey limit.' });
      const filename = safeZoteroFilename(stringValue(metadata.data.data.filename) || stringValue(metadata.data.data.title) || 'zotero-attachment');
      const contentType = stringValue(metadata.data.data.contentType) || response.headers.get('Content-Type') || 'application/octet-stream';
      const storagePath = `thesis-sources/${userId}/${Date.now()}-${filename}`;
      const { error: uploadError } = await supabase.storage.from(THESIS_SOURCE_BUCKET).upload(storagePath, buffer, {
        contentType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const nextSource = {
        ...source,
        attachmentName: filename,
        attachmentStoragePath: storagePath,
        attachmentMimeType: contentType,
        attachmentUploadedAt: new Date().toISOString(),
      };
      await saveThesisSourceRecord(userId, nextSource);
      return {
        source: nextSource,
        attachment: {
          name: filename,
          storagePath,
          mimeType: contentType,
          uploadedAt: nextSource.attachmentUploadedAt,
        },
      };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });

  server.post<{
    Params: { sourceId: string };
    Body: { storagePath?: string; filename?: string; mimeType?: string; confirmedRestricted?: boolean };
  }>('/zotero/sources/:sourceId/attachments/export', async (request, reply) => {
    const userId = await requireUser(request.headers.authorization, reply);
    if (!userId) return;
    try {
      const connection = await getZoteroConnection(userId);
      const link = await getSourceLink(userId, request.params.sourceId);
      const source = (await listThesisSources(userId)).find((item) => item.id === request.params.sourceId);
      if (!connection || !link || !source) return reply.status(404).send({ error: 'Linked Zotero source not found.' });
      if (source.verification === 'restricted' && !request.body?.confirmedRestricted) {
        return reply.status(409).send({ error: 'Confirm that this restricted source may be uploaded to Zotero.', confirmationRequired: true });
      }
      const storagePath = stringValue(request.body?.storagePath) || stringValue(source.attachmentStoragePath);
      if (!storagePath.startsWith(`thesis-sources/${userId}/`)) return reply.status(403).send({ error: 'That Odyssey attachment is not available.' });
      const filename = safeZoteroFilename(stringValue(request.body?.filename) || stringValue(source.attachmentName) || 'odyssey-source.pdf');
      const mimeType = stringValue(request.body?.mimeType) || stringValue(source.attachmentMimeType) || 'application/octet-stream';
      const { data: file, error: downloadError } = await supabase.storage.from(THESIS_SOURCE_BUCKET).download(storagePath);
      if (downloadError || !file) throw downloadError ?? new Error('Odyssey attachment could not be loaded.');
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.byteLength > MAX_ZOTERO_ATTACHMENT_BYTES) return reply.status(413).send({ error: 'Attachment exceeds the 32 MB transfer limit.' });
      const template = await zoteroJson<Record<string, unknown>>(connection.apiKey, '/items/new?itemType=attachment');
      const created = await zoteroJson<{ success?: Record<string, string> }>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Zotero-Write-Token': randomBytes(16).toString('hex') },
          body: JSON.stringify([{
            ...template.data,
            itemType: 'attachment',
            parentItem: link.item_key,
            linkMode: 'imported_file',
            title: filename,
            filename,
            contentType: mimeType,
            tags: [],
            relations: {},
          }]),
        },
      );
      const attachmentKey = created.data.success?.['0'];
      if (!attachmentKey) throw new Error('Zotero did not create the attachment record.');
      const md5 = createHash('md5').update(buffer).digest('hex');
      const mtime = Date.now().toString();
      const authorizeBody = new URLSearchParams({
        md5,
        filename,
        filesize: String(buffer.byteLength),
        mtime,
      });
      const authorization = await zoteroJson<Record<string, unknown>>(
        connection.apiKey,
        `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(attachmentKey)}/file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'If-None-Match': '*' },
          body: authorizeBody.toString(),
        },
      );
      if (!authorization.data.exists) {
        const url = stringValue(authorization.data.url);
        const prefix = typeof authorization.data.prefix === 'string' ? authorization.data.prefix : '';
        const suffix = typeof authorization.data.suffix === 'string' ? authorization.data.suffix : '';
        const contentType = stringValue(authorization.data.contentType);
        const uploadKey = stringValue(authorization.data.uploadKey);
        if (!url || !contentType || !uploadKey) throw new Error('Zotero returned incomplete file upload authorization.');
        const uploadBody = Buffer.concat([Buffer.from(prefix, 'utf8'), buffer, Buffer.from(suffix, 'utf8')]);
        const uploadResponse = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': contentType },
          body: new Uint8Array(uploadBody),
          signal: AbortSignal.timeout(60_000),
        });
        if (!uploadResponse.ok) throw new ZoteroApiError(uploadResponse.status, `Zotero storage upload failed (${uploadResponse.status})`);
        await zoteroRequest(
          connection.apiKey,
          `/users/${encodeURIComponent(connection.zoteroUserId)}/items/${encodeURIComponent(attachmentKey)}/file`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'If-None-Match': '*' },
            body: new URLSearchParams({ upload: uploadKey }).toString(),
          },
        );
      }
      const sync = await performZoteroSync(userId, { forceItemKeys: [link.item_key] });
      return { ok: true, attachmentKey, sources: sync.sources };
    } catch (error) {
      return sendZoteroError(reply, error);
    }
  });
}
