import type { FastifyInstance, FastifyRequest } from 'fastify';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const ALLOWED_PROXY_PREFIXES = [
  'auth/v1/',
  'rest/v1/',
  'storage/v1/',
  'realtime/v1/',
];

const ALLOWED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'accept-profile',
  'apikey',
  'authorization',
  'cache-control',
  'content-profile',
  'content-range',
  'content-type',
  'if-match',
  'if-none-match',
  'prefer',
  'range',
  'x-client-info',
  'x-upsert',
]);

const RESPONSE_HEADERS_TO_SKIP = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

type ProxyParams = {
  '*': string;
};

type ProxyFetchInit = RequestInit & {
  duplex?: 'half';
};

function buildUpstreamUrl(request: FastifyRequest<{ Params: ProxyParams }>, baseUrl: string): string {
  const path = request.params['*'] ?? '';
  const upstream = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`);
  const queryIndex = request.raw.url?.indexOf('?') ?? -1;
  if (queryIndex >= 0 && request.raw.url) {
    upstream.search = request.raw.url.slice(queryIndex);
  }
  return upstream.toString();
}

function isAllowedProxyPath(path: string): boolean {
  const normalized = path.replace(/^\/+/, '');
  if (normalized.includes('..')) return false;
  return ALLOWED_PROXY_PREFIXES.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function buildProxyHeaders(headers: FastifyRequest['headers']): Headers {
  const proxiedHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || value == null || !ALLOWED_REQUEST_HEADERS.has(lower)) continue;

    if (Array.isArray(value)) {
      for (const entry of value) proxiedHeaders.append(key, entry);
      continue;
    }

    proxiedHeaders.set(key, value);
  }

  return proxiedHeaders;
}

function buildRequestBody(request: FastifyRequest): BodyInit | undefined {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  if (request.body == null) {
    const contentLength = request.headers['content-length'];
    const transferEncoding = request.headers['transfer-encoding'];
    const normalizedLength = Array.isArray(contentLength) ? contentLength[0] : contentLength;

    if ((!normalizedLength || normalizedLength === '0') && !transferEncoding) {
      return undefined;
    }

    return request.raw as unknown as BodyInit;
  }
  if (
    typeof request.body === 'string' ||
    request.body instanceof Uint8Array ||
    Buffer.isBuffer(request.body) ||
    request.body instanceof ArrayBuffer
  ) {
    return request.body as BodyInit;
  }
  return JSON.stringify(request.body);
}

export async function supabaseProxyRoutes(server: FastifyInstance) {
  const upstreamBaseUrl = process.env.SUPABASE_URL;

  if (!upstreamBaseUrl) {
    throw new Error('SUPABASE_URL must be set for the Supabase proxy route');
  }

  // Supabase-js sends some DELETE requests with Content-Type: application/json
  // and an empty body. Fastify's default JSON parser rejects those before the
  // proxy handler runs, so accept an empty payload and treat it as no body.
  server.addContentTypeParser(
    ['application/json', 'application/*+json'],
    { parseAs: 'string' },
    (_request, body, done) => {
      const text = typeof body === 'string' ? body : body.toString('utf8');

      if (text.trim() === '') {
        done(null, undefined);
        return;
      }

      try {
        done(null, JSON.parse(text));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  server.route<{ Params: ProxyParams }>({
    method: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
    url: '/supabase/*',
    handler: async (request, reply) => {
      try {
        const proxyPath = request.params['*'] ?? '';
        if (!isAllowedProxyPath(proxyPath)) {
          return reply.status(403).send({ error: 'Supabase proxy path is not allowed' });
        }

        const upstreamUrl = buildUpstreamUrl(request, upstreamBaseUrl);
        const headers = buildProxyHeaders(request.headers);
        const body = buildRequestBody(request);

        if (body && !headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
        if (!body) {
          headers.delete('content-type');
        }

        const fetchOptions: ProxyFetchInit = {
          method: request.method,
          headers,
          body,
          duplex: body ? 'half' : undefined,
          redirect: 'manual',
        };

        const upstreamResponse = await fetch(upstreamUrl, fetchOptions);

        reply.code(upstreamResponse.status);

        upstreamResponse.headers.forEach((value, key) => {
          if (RESPONSE_HEADERS_TO_SKIP.has(key.toLowerCase())) return;
          reply.header(key, value);
        });

        if (request.method === 'HEAD' || upstreamResponse.status === 204) {
          return reply.send();
        }

        const payload = Buffer.from(await upstreamResponse.arrayBuffer());
        return reply.send(payload);
      } catch (error) {
        request.log.error({ err: error }, 'Supabase proxy request failed');
        return reply.status(502).send({ error: 'Supabase proxy request failed' });
      }
    },
  });
}
