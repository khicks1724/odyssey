const rawBaseUrl = (import.meta.env.BASE_URL as string | undefined) ?? '/';

export function normalizeBasePath(value: string | undefined | null): string {
  const trimmed = value?.trim();

  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

export const appBasePath = normalizeBasePath(rawBaseUrl);
export const routerBasename = appBasePath === '/' ? '/' : appBasePath.slice(0, -1);

export function withBasePath(path: string): string {
  if (!path) return routerBasename || '/';
  if (/^[a-z]+:\/\//i.test(path) || path.startsWith('//')) return path;

  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return appBasePath === '/' ? `/${normalizedPath}` : `${routerBasename}/${normalizedPath}`;
}

export function toAbsoluteAppUrl(path: string): string {
  return new URL(withBasePath(path), window.location.origin).toString();
}
