import Fastify from 'fastify';
import cors from '@fastify/cors';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhooks.js';

const server = Fastify({ logger: true });

await server.register(cors, {
  origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
});

// Routes
await server.register(healthRoutes, { prefix: '/api' });
await server.register(webhookRoutes, { prefix: '/api/webhooks' });

const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
  console.log(`Odyssey API running on ${host}:${port}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
