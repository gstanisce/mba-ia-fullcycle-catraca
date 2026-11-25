import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';

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

  return app;
}
