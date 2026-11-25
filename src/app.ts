import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { registerAuth } from './features/auth/plugin.js';
import { registerStubs } from './features/stubs.js';

/**
 * Builds the HTTP app. Each feature exposes a Fastify plugin under src/features/<area>/
 * and registers it below (one line per feature).
 */
export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  await app.register(formbody);
  await app.register(cookie);

  app.get('/health', async () => ({ status: 'ok' }));

  // --- feature plugins (keep one per line) ---
  registerAuth(app); // F01: session hook (request.user) + signup/login/logout; root level, not encapsulated
  registerStubs(app); // F01: temporary / and /organizer (removed by F02)

  return app;
}
