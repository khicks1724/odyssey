import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { healthRoutes } from './routes/health.js';
import { webhookRoutes } from './routes/webhooks.js';
import { githubRoutes } from './routes/github.js';
import { aiRoutes } from './routes/ai.js';
import { microsoftRoutes } from './routes/microsoft.js';
import { uploadRoutes } from './routes/uploads.js';
import { gitlabRoutes } from './routes/gitlab.js';
import { userAiKeysRoutes } from './routes/user-ai-keys.js';
import { authRoutes } from './routes/auth.js';
import { supabaseProxyRoutes } from './routes/supabase-proxy.js';
import { getAvailableProviders } from './ai-providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const server = Fastify({ logger: true });

// In production serve the built React app from client/dist
if (isProd) {
  const clientDist = process.env.CLIENT_DIST_PATH ?? path.join(__dirname, '../client');
  await server.register(staticPlugin, { root: clientDist, prefix: '/' });
  // SPA fallback — any non-API route serves index.html
  server.setNotFoundHandler((_req, reply) => {
    reply.sendFile('index.html');
  });
} else {
  await server.register(cors, {
    origin: process.env.CLIENT_URL ?? 'http://localhost:5173',
  });
}

// Routes
await server.register(healthRoutes, { prefix: '/api' });
await server.register(webhookRoutes, { prefix: '/api/webhooks' });
await server.register(githubRoutes, { prefix: '/api' });
await server.register(aiRoutes, { prefix: '/api' });
await server.register(microsoftRoutes, { prefix: '/api' });
await server.register(uploadRoutes, { prefix: '/api' });
await server.register(gitlabRoutes, { prefix: '/api' });
await server.register(userAiKeysRoutes, { prefix: '/api' });
await server.register(authRoutes, { prefix: '/api' });
await server.register(supabaseProxyRoutes);

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
  console.log(`Odyssey API running on ${host}:${port}`);

  const providers = getAvailableProviders();
  const active = providers.filter((p) => p.available).map((p) => p.name);
  const inactive = providers.filter((p) => !p.available).map((p) => p.name);
  if (active.length > 0) console.log(`AI providers active: ${active.join(', ')}`);
  if (inactive.length > 0) console.log(`AI providers inactive (no API key): ${inactive.join(', ')}`);
  if (active.length === 0) console.warn('WARNING: No AI providers configured yet — users need to add provider keys in Settings → AI Providers');
  if (!process.env.GITHUB_WEBHOOK_SECRET) console.warn('WARNING: GITHUB_WEBHOOK_SECRET not set — webhook signature verification disabled');
  if (!process.env.MICROSOFT_CLIENT_ID) console.warn('WARNING: MICROSOFT_CLIENT_ID not set — Microsoft 365 integration disabled');
  if (!process.env.MICROSOFT_TOKEN_ENCRYPT_KEY) console.warn('WARNING: MICROSOFT_TOKEN_ENCRYPT_KEY not set — tokens stored unencrypted (insecure)');
  console.log('GitLab integration uses per-project repository URLs and personal access tokens');
  console.log(`Supabase service key loaded: ${process.env.SUPABASE_SERVICE_KEY ? 'YES' : 'NO'}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
