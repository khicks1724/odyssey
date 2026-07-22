import type { FastifyInstance } from 'fastify';
import {
  completeGenAiBrowserRelay,
  pollGenAiBrowserRelay,
  type GenAiBrowserRelayResponse,
} from '../lib/genai-browser-relay.js';
import { getUserFromAuthHeader } from '../lib/request-auth.js';

const MAX_CLIENT_ID_LENGTH = 120;
const MAX_RESPONSE_BODY_LENGTH = 4 * 1024 * 1024;

function cleanClientId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > MAX_CLIENT_ID_LENGTH || !/^[a-zA-Z0-9:._-]+$/.test(cleaned)) return null;
  return cleaned;
}

function cleanHeaderValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

export async function genAiBrowserRelayRoutes(server: FastifyInstance) {
  server.post<{ Body: { clientId?: unknown } }>('/ai/genai-browser-relay/poll', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    const clientId = cleanClientId(request.body?.clientId);
    if (!clientId) return reply.status(400).send({ error: 'A valid browser relay clientId is required' });

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    request.raw.once('aborted', onAbort);
    try {
      const relayRequest = await pollGenAiBrowserRelay(userId, clientId, controller.signal);
      if (!relayRequest) return reply.status(204).send();
      reply.header('Cache-Control', 'no-store');
      return { request: relayRequest };
    } finally {
      request.raw.off('aborted', onAbort);
    }
  });

  server.post<{
    Params: { requestId: string };
    Body: {
      ok?: unknown;
      status?: unknown;
      body?: unknown;
      contentType?: unknown;
      retryAfter?: unknown;
      error?: unknown;
    };
  }>('/ai/genai-browser-relay/:requestId/result', async (request, reply) => {
    const userId = await getUserFromAuthHeader(request.headers.authorization);
    if (!userId) return reply.status(401).send({ error: 'Unauthorized' });
    const requestId = request.params.requestId;
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) {
      return reply.status(400).send({ error: 'Invalid relay request ID' });
    }

    const body = request.body ?? {};
    let accepted: boolean;
    if (body.ok === true) {
      const status = Number(body.status);
      if (!Number.isInteger(status) || status < 100 || status > 599 || typeof body.body !== 'string') {
        return reply.status(400).send({ error: 'Invalid browser relay response' });
      }
      if (body.body.length > MAX_RESPONSE_BODY_LENGTH) {
        return reply.status(413).send({ error: 'Browser relay response is too large' });
      }
      const response: GenAiBrowserRelayResponse = {
        status,
        body: body.body,
        contentType: cleanHeaderValue(body.contentType),
        retryAfter: cleanHeaderValue(body.retryAfter),
      };
      accepted = completeGenAiBrowserRelay(userId, requestId, { ok: true, response });
    } else {
      const detail = typeof body.error === 'string'
        ? body.error.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 800)
        : '';
      const error = detail
        ? `The browser could not complete the GenAI.mil request: ${detail}`
        : 'The browser could not complete the GenAI.mil request. Confirm the browser is on an approved DoW network and that GenAI.mil permits browser CORS requests.';
      accepted = completeGenAiBrowserRelay(userId, requestId, { ok: false, error });
    }

    if (!accepted) return reply.status(404).send({ error: 'Relay request is no longer pending' });
    return { ok: true };
  });
}
