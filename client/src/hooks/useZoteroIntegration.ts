import { useCallback, useEffect, useState } from 'react';
import {
  disconnectZotero,
  fetchZoteroStatus,
  startZoteroConnection,
  syncZotero,
  type ZoteroStatus,
} from '../lib/zotero';

export function useZoteroIntegration() {
  const [status, setStatus] = useState<ZoteroStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await fetchZoteroStatus());
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load Zotero status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const connect = useCallback(async (returnPath = '/thesis?tab=sources') => {
    setConnecting(true);
    setError(null);
    try {
      await startZoteroConnection(returnPath);
    } catch (nextError) {
      setConnecting(false);
      setError(nextError instanceof Error ? nextError.message : 'Failed to start Zotero connection.');
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await disconnectZotero();
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to disconnect Zotero.');
    }
  }, [refresh]);

  const sync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncZotero();
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Zotero sync failed.');
    } finally {
      setSyncing(false);
    }
  }, [refresh]);

  return { status, loading, connecting, syncing, error, connect, disconnect, sync, refresh };
}
