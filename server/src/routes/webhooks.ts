import type { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';

export async function webhookRoutes(server: FastifyInstance) {
  // GitHub webhook receiver — normalizes events into the unified events table
  server.post('/github', async (request: FastifyRequest, reply) => {
    const signature = request.headers['x-hub-signature-256'] as string | undefined;
    const event = request.headers['x-github-event'] as string | undefined;

    // Verify webhook signature if secret is configured
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (secret && signature) {
      const payload = JSON.stringify(request.body);
      const expected =
        'sha256=' +
        crypto.createHmac('sha256', secret).update(payload).digest('hex');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return reply.code(401).send({ error: 'Invalid signature' });
      }
    }

    server.log.info({ event }, 'Received GitHub webhook');

    // TODO: Normalize the GitHub event into the unified events table
    // For now, just acknowledge receipt
    return { received: true, event };
  });
}
