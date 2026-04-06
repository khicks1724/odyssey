import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const API_BASE = '/api';

export interface MSConnectionStatus {
  connected: boolean;
  email: string | null;
  displayName: string | null;
  connectedAt: string | null;
}

async function getAuthHeader(): Promise<{ Authorization: string } | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.access_token}` };
}

export function useMicrosoftIntegration() {
  const [status, setStatus] = useState<MSConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    const headers = await getAuthHeader();
    if (!headers) { setLoading(false); return; }

    try {
      const res = await fetch(`${API_BASE}/microsoft/status`, { headers });
      if (res.ok) {
        const data: MSConnectionStatus = await res.json();
        setStatus(data);
      }
    } catch {
      /* server may not be running yet */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check if returning from Microsoft OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('ms_connected') === 'true' || params.get('ms_error')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    fetchStatus();
  }, [fetchStatus]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectError(null);
    const headers = await getAuthHeader();
    if (!headers) {
      setConnectError('Not signed in — please refresh and try again.');
      setConnecting(false);
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/microsoft/auth/url`, { headers });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setConnectError(err.error ?? `Server error (${res.status}) — is the server running?`);
        setConnecting(false);
        return;
      }
      const { url } = await res.json() as { url: string };
      window.location.href = url;
    } catch {
      setConnectError('Cannot reach the server — make sure it is running on port 3000.');
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const headers = await getAuthHeader();
    if (!headers) return;

    await fetch(`${API_BASE}/microsoft/connection`, { method: 'DELETE', headers });
    setStatus({ connected: false, email: null, displayName: null, connectedAt: null });
  }, []);

  return { status, loading, connecting, connectError, connect, disconnect, refresh: fetchStatus };
}

// ── Microsoft Graph data fetching utilities ──────────────────────────────────

export async function fetchOneNoteNotebooks() {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const res = await fetch(`${API_BASE}/microsoft/onenote/notebooks`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { notebooks: unknown[] };
  return data.notebooks;
}

export async function fetchOneNoteSections(notebookId: string, groupId?: string) {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const params = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
  const res = await fetch(`${API_BASE}/microsoft/onenote/notebooks/${encodeURIComponent(notebookId)}/sections${params}`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { sections: unknown[] };
  return data.sections;
}

export async function fetchOneNotePages(sectionId: string, groupId?: string) {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const params = groupId ? `?groupId=${encodeURIComponent(groupId)}` : '';
  const res = await fetch(`${API_BASE}/microsoft/onenote/sections/${encodeURIComponent(sectionId)}/pages${params}`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { pages: unknown[] };
  return data.pages;
}

export async function fetchTeams() {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const res = await fetch(`${API_BASE}/microsoft/teams`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { teams: unknown[] };
  return data.teams;
}

export async function fetchTeamChannels(groupId: string) {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const res = await fetch(`${API_BASE}/microsoft/teams/${encodeURIComponent(groupId)}/channels`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { channels: unknown[] };
  return data.channels;
}

export async function fetchTeamChannelFiles(groupId: string, channelId: string, opts: { folderId?: string; driveId?: string } = {}) {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const params = new URLSearchParams();
  if (opts.folderId) params.set('folderId', opts.folderId);
  if (opts.driveId) params.set('driveId', opts.driveId);
  const qs = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/microsoft/teams/${encodeURIComponent(groupId)}/channels/${encodeURIComponent(channelId)}/files${qs}`, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { files: unknown[] };
  return data.files;
}

export async function fetchTeamFileContent(driveId: string, itemId: string) {
  const headers = await getAuthHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE}/microsoft/teams/drives/${encodeURIComponent(driveId)}/files/${encodeURIComponent(itemId)}/content`, { headers });
  if (!res.ok) return null;
  return res.json() as Promise<{ name: string; mimeType: string; text: string }>;
}

export async function deleteImportedEvent(eventId: string) {
  const headers = await getAuthHeader();
  if (!headers) return false;
  const res = await fetch(`${API_BASE}/microsoft/import/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers });
  return res.ok;
}

export async function fetchOneNotePageContent(pageId: string) {
  const headers = await getAuthHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE}/microsoft/onenote/pages/${encodeURIComponent(pageId)}/content`, { headers });
  if (!res.ok) return null;
  return res.json() as Promise<{ html: string; text: string }>;
}

export async function fetchOneDriveFiles(opts: { folderId?: string; search?: string } = {}) {
  const headers = await getAuthHeader();
  if (!headers) return [];
  const params = new URLSearchParams();
  if (opts.folderId) params.set('folderId', opts.folderId);
  if (opts.search) params.set('search', opts.search);
  const url = `${API_BASE}/microsoft/onedrive/files${params.toString() ? '?' + params.toString() : ''}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = await res.json() as { files: unknown[] };
  return data.files;
}

export async function fetchOneDriveFileContent(itemId: string) {
  const headers = await getAuthHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE}/microsoft/onedrive/files/${encodeURIComponent(itemId)}/content`, { headers });
  if (!res.ok) return null;
  return res.json() as Promise<{ name: string; mimeType: string; text: string }>;
}

export async function importToProject(opts: {
  projectId: string;
  source: 'onenote' | 'onedrive';
  itemId: string;
  title: string;
  webUrl?: string;
  content?: string;
}) {
  const headers = await getAuthHeader();
  if (!headers) return null;
  const res = await fetch(`${API_BASE}/microsoft/import`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!res.ok) return null;
  return res.json();
}
