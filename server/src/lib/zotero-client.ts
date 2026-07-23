import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';

const ZOTERO_API_BASE = 'https://api.zotero.org';
const ZOTERO_REQUEST_TOKEN_URL = 'https://www.zotero.org/oauth/request';
const ZOTERO_ACCESS_TOKEN_URL = 'https://www.zotero.org/oauth/access';
const ZOTERO_AUTHORIZE_URL = 'https://www.zotero.org/oauth/authorize';

export type EncryptedSecret = {
  encrypted: string;
  iv: string;
  authTag: string;
};

export type ZoteroApiResult<T> = {
  data: T;
  status: number;
  libraryVersion: number | null;
  totalResults: number | null;
  link: string | null;
  backoffSeconds: number | null;
  retryAfterSeconds: number | null;
};

export type ZoteroOAuthTokenResponse = {
  oauthToken: string;
  oauthTokenSecret: string;
  userId: string | null;
  username: string | null;
};

export class ZoteroApiError extends Error {
  status: number;
  retryAfterSeconds: number | null;
  body: string;

  constructor(status: number, message: string, body = '', retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'ZoteroApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.body = body;
  }
}

function encryptionKey() {
  const value = process.env.ZOTERO_TOKEN_ENCRYPT_KEY?.trim() ?? '';
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error('ZOTERO_TOKEN_ENCRYPT_KEY must be a 64-character hex value');
  }
  return Buffer.from(value, 'hex');
}

export function isZoteroEncryptionConfigured() {
  return /^[0-9a-f]{64}$/i.test(process.env.ZOTERO_TOKEN_ENCRYPT_KEY?.trim() ?? '');
}

export function isZoteroOAuthConfigured() {
  return Boolean(
    process.env.ZOTERO_CLIENT_KEY?.trim()
    && process.env.ZOTERO_CLIENT_SECRET?.trim()
    && process.env.ZOTERO_REDIRECT_URI?.trim()
    && isZoteroEncryptionConfigured(),
  );
}

export function encryptZoteroSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptZoteroSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function hashZoteroState(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function oauthEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function oauthHeader(
  method: string,
  urlValue: string,
  additions: Record<string, string>,
  tokenSecret = '',
) {
  const clientKey = process.env.ZOTERO_CLIENT_KEY?.trim() ?? '';
  const clientSecret = process.env.ZOTERO_CLIENT_SECRET?.trim() ?? '';
  if (!clientKey || !clientSecret) throw new Error('Zotero OAuth is not configured');

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: clientKey,
    oauth_nonce: randomBytes(18).toString('base64url'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...additions,
  };
  const url = new URL(urlValue);
  const signatureParams: Array<[string, string]> = Object.entries(oauthParams);
  for (const [key, value] of url.searchParams.entries()) signatureParams.push([key, value]);
  signatureParams.sort(([leftKey, leftValue], [rightKey, rightValue]) => (
    oauthEncode(leftKey).localeCompare(oauthEncode(rightKey))
    || oauthEncode(leftValue).localeCompare(oauthEncode(rightValue))
  ));
  const normalized = signatureParams
    .map(([key, value]) => `${oauthEncode(key)}=${oauthEncode(value)}`)
    .join('&');
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const signatureBase = [method.toUpperCase(), oauthEncode(baseUrl), oauthEncode(normalized)].join('&');
  const signingKey = `${oauthEncode(clientSecret)}&${oauthEncode(tokenSecret)}`;
  oauthParams.oauth_signature = createHmac('sha1', signingKey).update(signatureBase).digest('base64');

  return `OAuth ${Object.entries(oauthParams)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${oauthEncode(key)}="${oauthEncode(value)}"`)
    .join(', ')}`;
}

function parseOAuthResponse(body: string): ZoteroOAuthTokenResponse {
  const params = new URLSearchParams(body);
  const oauthToken = params.get('oauth_token') ?? '';
  const oauthTokenSecret = params.get('oauth_token_secret') ?? '';
  if (!oauthToken || !oauthTokenSecret) {
    throw new Error('Zotero returned an incomplete OAuth token response');
  }
  return {
    oauthToken,
    oauthTokenSecret,
    userId: params.get('userID'),
    username: params.get('username'),
  };
}

async function oauthPost(url: string, authorization: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ZoteroApiError(response.status, `Zotero OAuth failed (${response.status})`, body);
  }
  return parseOAuthResponse(body);
}

export async function requestZoteroOAuthToken(callbackUrl: string) {
  return oauthPost(
    ZOTERO_REQUEST_TOKEN_URL,
    oauthHeader('POST', ZOTERO_REQUEST_TOKEN_URL, { oauth_callback: callbackUrl }),
  );
}

export async function exchangeZoteroOAuthToken(input: {
  requestToken: string;
  requestSecret: string;
  verifier: string;
}) {
  return oauthPost(
    ZOTERO_ACCESS_TOKEN_URL,
    oauthHeader('POST', ZOTERO_ACCESS_TOKEN_URL, {
      oauth_token: input.requestToken,
      oauth_verifier: input.verifier,
    }, input.requestSecret),
  );
}

export function buildZoteroAuthorizeUrl(requestToken: string) {
  const params = new URLSearchParams({
    oauth_token: requestToken,
    name: 'Odyssey Thesis',
    library_access: '1',
    notes_access: '1',
    write_access: '1',
    all_groups: 'none',
  });
  return `${ZOTERO_AUTHORIZE_URL}?${params.toString()}`;
}

function parseIntegerHeader(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function zoteroRequest(
  apiKey: string,
  pathOrUrl: string,
  init: RequestInit = {},
) {
  const url = /^https:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${ZOTERO_API_BASE}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
  const headers = new Headers(init.headers);
  headers.set('Zotero-API-Key', apiKey);
  headers.set('Zotero-API-Version', '3');
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const response = await fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ZoteroApiError(
      response.status,
      body || `Zotero request failed (${response.status})`,
      body,
      parseIntegerHeader(response.headers.get('Retry-After')),
    );
  }
  return response;
}

export async function downloadZoteroFile(apiKey: string, zoteroUserId: string, itemKey: string) {
  const response = await fetch(
    `${ZOTERO_API_BASE}/users/${encodeURIComponent(zoteroUserId)}/items/${encodeURIComponent(itemKey)}/file`,
    {
      headers: {
        'Zotero-API-Key': apiKey,
        'Zotero-API-Version': '3',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('Location');
    if (!location) throw new ZoteroApiError(response.status, 'Zotero file redirect was incomplete');
    const download = await fetch(location, { signal: AbortSignal.timeout(60_000) });
    if (!download.ok) throw new ZoteroApiError(download.status, `Zotero file download failed (${download.status})`);
    return download;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new ZoteroApiError(response.status, body || `Zotero file download failed (${response.status})`, body);
  }
  return response;
}

export async function zoteroJson<T>(
  apiKey: string,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<ZoteroApiResult<T>> {
  const response = await zoteroRequest(apiKey, pathOrUrl, init);
  const text = await response.text();
  const data = (text ? JSON.parse(text) : null) as T;
  return {
    data,
    status: response.status,
    libraryVersion: parseIntegerHeader(
      response.headers.get('Last-Modified-Version')
      ?? response.headers.get('Zotero-Library-Version'),
    ),
    totalResults: parseIntegerHeader(response.headers.get('Total-Results')),
    link: response.headers.get('Link'),
    backoffSeconds: parseIntegerHeader(response.headers.get('Backoff')),
    retryAfterSeconds: parseIntegerHeader(response.headers.get('Retry-After')),
  };
}

export async function validateZoteroApiKey(apiKey: string) {
  return zoteroJson<Record<string, unknown>>(
    apiKey,
    `/keys/${encodeURIComponent(apiKey)}`,
  );
}

export function buildZoteroClientRedirect(pathname: string, query: Record<string, string>) {
  const baseValue = process.env.CLIENT_URL?.trim() || 'http://localhost:5173/';
  const base = baseValue.endsWith('/') ? baseValue : `${baseValue}/`;
  const url = new URL(pathname.replace(/^\//, ''), base);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

export function publicZoteroCallbackUrl(state: string) {
  const configured = process.env.ZOTERO_REDIRECT_URI?.trim();
  if (!configured) throw new Error('ZOTERO_REDIRECT_URI is not configured');
  const url = new URL(configured);
  url.searchParams.set('state', state);
  return url.toString();
}

export function safeZoteroFilename(value: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'zotero-attachment';
}
