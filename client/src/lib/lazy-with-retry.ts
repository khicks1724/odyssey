import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

function isRetryableLazyImportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('dynamically imported module') ||
    message.includes('chunkloaderror') ||
    message.includes('importing a module script failed')
  );
}

export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  key: string,
): LazyExoticComponent<T> {
  return lazy(async () => {
    const storageKey = `odyssey:lazy-retry:${key}`;

    try {
      const module = await importer();
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(storageKey);
      }
      return module;
    } catch (error) {
      if (
        typeof window !== 'undefined' &&
        isRetryableLazyImportError(error) &&
        !window.sessionStorage.getItem(storageKey)
      ) {
        window.sessionStorage.setItem(storageKey, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }

      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(storageKey);
      }

      throw error;
    }
  });
}
