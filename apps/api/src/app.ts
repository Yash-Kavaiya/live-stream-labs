import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError, type Deps } from './http/context';
import { authRoutes } from './routes/auth';
import { broadcastRoutes } from './routes/broadcasts';
import { destinationRoutes } from './routes/destinations';
import { fileRoutes } from './routes/files';
import { liveRoutes } from './routes/live';
import { rundownRoutes } from './routes/rundowns';

export async function buildApp(deps: Deps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: deps.config.env === 'test' ? false : { level: 'info' },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(cors, { origin: deps.config.webOrigin, credentials: true });

  // LiveKit signs the exact bytes of its webhook body, so keep it as a string.
  app.addContentTypeParser('application/webhook+json', { parseAs: 'string' }, (_req, body, done) =>
    done(null, body),
  );

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  authRoutes(app, deps);
  destinationRoutes(app, deps);
  broadcastRoutes(app, deps);
  liveRoutes(app, deps);
  fileRoutes(app, deps);
  rundownRoutes(app, deps);

  return app;
}
