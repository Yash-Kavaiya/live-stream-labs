import type { Rundown, RundownStatusDto } from '@studio/shared';
import type { FastifyInstance } from 'fastify';
import { badRequest, notFound, requireUserId, type Deps } from '../http/context';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The daily news rundown. It belongs to the installation, so any signed-in user may read and remake it. */
export function rundownRoutes(app: FastifyInstance, deps: Deps): void {
  const { rundowns, config } = deps;

  const status = async (): Promise<RundownStatusDto> => ({
    rundown: await rundowns.latest(),
    generating: rundowns.generating,
    error: rundowns.generating ? null : rundowns.lastError,
    show: config.news.show,
    fixture: config.news.fixture,
  });

  // Registered before `/:date`, so "latest" is never read as a date.
  app.get('/api/rundowns/latest', async (req): Promise<RundownStatusDto> => {
    await requireUserId(deps, req);
    return status();
  });

  app.get('/api/rundowns', async (req): Promise<string[]> => {
    await requireUserId(deps, req);
    return rundowns.dates();
  });

  app.get('/api/rundowns/:date', async (req): Promise<Rundown> => {
    await requireUserId(deps, req);
    const { date } = req.params as { date: string };
    if (!DATE.test(date)) throw badRequest('The date must look like 2026-10-06');
    const rundown = await rundowns.byDate(date);
    if (!rundown) throw notFound('Rundown');
    return rundown;
  });

  /** Starts making today's rundown and answers at once; the studio asks `latest` until it is done. */
  app.post('/api/rundowns/generate', async (req): Promise<RundownStatusDto> => {
    await requireUserId(deps, req);
    void rundowns.generate();
    return status();
  });
}
