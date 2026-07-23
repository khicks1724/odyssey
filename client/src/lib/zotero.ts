import { toAbsoluteAppUrl } from './base-path';
import { supabase } from './supabase';

export type ZoteroStatus = {
  configured: boolean;
  oauthConfigured: boolean;
  apiKeyConfigured: boolean;
  connected: boolean;
  connectionMethod?: 'oauth' | 'api_key';
  zoteroUserId?: string;
  username?: string | null;
  permissions?: Record<string, unknown>;
  selectedCollectionKeys?: string[];
  syncAll?: boolean;
  lastLibraryVersion?: number;
  lastSyncAt?: string | null;
  lastSyncStatus?: 'idle' | 'syncing' | 'ok' | 'error' | 'backoff';
  lastSyncError?: string | null;
  backoffUntil?: string | null;
  conflictCount: number;
};

export type ZoteroCollection = {
  key: string;
  version: number;
  data: {
    name?: string;
    parentCollection?: string | false;
  };
  meta?: { numCollections?: number; numItems?: number };
};

export type ZoteroItem = {
  key: string;
  version: number;
  bib?: string;
  citation?: string;
  data: {
    itemType?: string;
    title?: string;
    creators?: Array<{ creatorType?: string; firstName?: string; lastName?: string; name?: string }>;
    date?: string;
    publicationTitle?: string;
    proceedingsTitle?: string;
    bookTitle?: string;
    url?: string;
    DOI?: string;
    tags?: Array<{ tag?: string; type?: number }>;
  };
};

export type ZoteroConflict = {
  id: string;
  sourceId: string;
  itemKey: string;
  fields: Record<string, { base: unknown; local: unknown; remote: unknown }>;
  remoteVersion: number;
  createdAt: string;
};

async function authHeaders(json = false) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(body.error || `Zotero request failed (${response.status})`) as Error & {
      status?: number;
      confirmationRequired?: boolean;
    };
    error.status = response.status;
    error.confirmationRequired = Boolean((body as { confirmationRequired?: boolean }).confirmationRequired);
    throw error;
  }
  return body;
}

async function request<T>(path: string, init: RequestInit = {}, json = false) {
  const headers = new Headers(await authHeaders(json));
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return parseResponse<T>(await fetch(toAbsoluteAppUrl(path), { ...init, headers }));
}

export function fetchZoteroStatus() {
  return request<ZoteroStatus>('/api/zotero/status');
}

export async function startZoteroConnection(returnPath = '/thesis?tab=sources') {
  const result = await request<{ url: string }>('/api/zotero/auth/start', {
    method: 'POST',
    body: JSON.stringify({ returnPath }),
  }, true);
  window.location.assign(result.url);
}

export function connectZoteroWithApiKey(apiKey: string) {
  return request<ZoteroStatus>('/api/zotero/connection/api-key', {
    method: 'POST',
    body: JSON.stringify({ apiKey }),
  }, true);
}

export function disconnectZotero() {
  return request<{ disconnected: boolean; retainedSources: boolean }>('/api/zotero/connection', { method: 'DELETE' });
}

export function fetchZoteroCollections() {
  return request<{ collections: ZoteroCollection[] }>('/api/zotero/collections');
}

export function fetchZoteroItems(input: {
  query?: string;
  collectionKey?: string;
  start?: number;
  limit?: number;
  style?: string;
  tag?: string;
  itemType?: string;
} = {}) {
  const params = new URLSearchParams();
  if (input.query) params.set('q', input.query);
  if (input.collectionKey) params.set('collectionKey', input.collectionKey);
  if (typeof input.start === 'number') params.set('start', String(input.start));
  if (typeof input.limit === 'number') params.set('limit', String(input.limit));
  if (input.style) params.set('style', input.style);
  if (input.tag) params.set('tag', input.tag);
  if (input.itemType) params.set('itemType', input.itemType);
  return request<{ items: ZoteroItem[]; total: number; start: number; limit: number; libraryVersion: number | null }>(
    `/api/zotero/items${params.size ? `?${params.toString()}` : ''}`,
  );
}

export function importZoteroItems(input: {
  itemKeys: string[];
  selectedCollectionKeys?: string[];
  syncAll?: boolean;
}) {
  return request<{ ok: boolean; sources: unknown[]; importedCount: number; skippedCount: number }>('/api/zotero/import', {
    method: 'POST',
    body: JSON.stringify(input),
  }, true);
}

export function syncZotero(input?: { selectedCollectionKeys?: string[]; syncAll?: boolean }) {
  return request<{ ok: boolean; conflictCount: number; lastSyncAt: string; sources: unknown[] }>('/api/zotero/sync', {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  }, true);
}

export function fetchZoteroConflicts() {
  return request<{ conflicts: ZoteroConflict[] }>('/api/zotero/conflicts');
}

export function resolveZoteroConflict(
  conflictId: string,
  resolutions: Record<string, 'local' | 'remote' | { value: unknown }>,
) {
  return request<{ ok: boolean; sources: unknown[] }>(`/api/zotero/conflicts/${encodeURIComponent(conflictId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolutions }),
  }, true);
}

export function exportSourceToZotero(sourceId: string) {
  return request<{ source: unknown }>(`/api/zotero/sources/${encodeURIComponent(sourceId)}/export`, { method: 'POST' });
}

export function unlinkZoteroSource(sourceId: string) {
  return request<{ source: unknown }>(`/api/zotero/sources/${encodeURIComponent(sourceId)}/link`, { method: 'DELETE' });
}

export function saveZoteroNote(sourceId: string, input: { html: string; noteKey?: string; version?: number }) {
  return request<{ ok: boolean; sources: unknown[] }>(`/api/zotero/sources/${encodeURIComponent(sourceId)}/notes`, {
    method: 'POST',
    body: JSON.stringify(input),
  }, true);
}

export function deleteZoteroNote(sourceId: string, noteKey: string, version: number) {
  const params = new URLSearchParams({ version: String(version) });
  return request<{ ok: boolean; sources: unknown[] }>(
    `/api/zotero/sources/${encodeURIComponent(sourceId)}/notes/${encodeURIComponent(noteKey)}?${params.toString()}`,
    { method: 'DELETE' },
  );
}

export function importZoteroAttachment(sourceId: string, attachmentKey: string, confirmedRestricted = false) {
  return request<{ source: unknown; attachment: unknown }>(
    `/api/zotero/sources/${encodeURIComponent(sourceId)}/attachments/${encodeURIComponent(attachmentKey)}/import`,
    { method: 'POST', body: JSON.stringify({ confirmedRestricted }) },
    true,
  );
}

export function exportAttachmentToZotero(sourceId: string, input: {
  storagePath?: string;
  filename?: string;
  mimeType?: string;
  confirmedRestricted?: boolean;
} = {}) {
  return request<{ ok: boolean; attachmentKey: string; sources: unknown[] }>(
    `/api/zotero/sources/${encodeURIComponent(sourceId)}/attachments/export`,
    { method: 'POST', body: JSON.stringify(input) },
    true,
  );
}

export function fetchZoteroFulltext(itemKey: string) {
  return request<{ content?: string; indexedPages?: number; totalPages?: number; indexedChars?: number; totalChars?: number }>(
    `/api/zotero/items/${encodeURIComponent(itemKey)}/fulltext`,
  );
}

export async function downloadZoteroExport(itemKeys: string[], format: 'bibtex' | 'biblatex' | 'ris' | 'csljson') {
  const params = new URLSearchParams({ itemKeys: itemKeys.join(','), format });
  const response = await fetch(toAbsoluteAppUrl(`/api/zotero/export?${params.toString()}`), {
    headers: await authHeaders(),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Zotero export failed (${response.status})`);
  }
  return response.text();
}

export const ZOTERO_CSL_STYLE_BY_FORMAT: Record<string, string> = {
  apa: 'apa',
  chicago: 'chicago-author-date',
  ieee: 'ieee',
  informs: 'informs-journal-on-computing',
  asme: 'american-society-of-mechanical-engineers',
  aiaa: 'american-institute-of-aeronautics-and-astronautics',
  ams: 'american-meteorological-society',
};
