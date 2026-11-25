import Fastify, { type FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cookie from '@fastify/cookie';
import { registerAuth } from './features/auth/plugin.js';
import { registerCheckin } from './features/checkin/plugin.js';
import { registerOrganizerEventRoutes } from './features/events/organizer-routes.js';
import { registerPublicEventRoutes } from './features/events/public-routes.js';
import { startGatewayPoller } from './features/purchases/gateway.js';
import { registerPurchaseRoutes } from './features/purchases/routes.js';
import { registerCancellationRoutes } from './features/cancellation/plugin.js';

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
  registerPublicEventRoutes(app); // F02: showcase / and /events/:id (purchase slot)
  registerOrganizerEventRoutes(app); // F02: /organizer area, event management page and its sections
  registerPurchaseRoutes(app); // F03: purchase slot, POST /events/:id/purchase, /my-tickets
  app.register(import('./features/partner-api/plugin.js'), { prefix: '/api/partner' }); // F04: partner API (X-Api-Key)
  registerCheckin(app); // F05: management-page section "Check-in" + POST /organizer/events/:id/checkin
  startGatewayPoller(app); // F03: delivers simulated gateway answers (onReady → start, onClose → stop)
  registerCancellationRoutes(app); // F06: management section `Cancelamento` + POST /organizer/events/:id/cancel

  return app;
}
