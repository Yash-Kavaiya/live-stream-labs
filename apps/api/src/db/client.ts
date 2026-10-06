import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
}

/** Works from both `src/db` (tsx) and the bundled `dist`. */
function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = ['../../drizzle', '../drizzle'].map((p) => path.resolve(here, p)).find(existsSync);
  if (!found) throw new Error('Migrations folder not found');
  return found;
}

/**
 * Postgres when `databaseUrl` is set, otherwise embedded PGlite: on disk under `dataDir`,
 * or in memory when `dataDir` is undefined (tests). Same dialect and migrations either way.
 */
export async function openDb(opts: { databaseUrl?: string; dataDir?: string }): Promise<DbHandle> {
  if (opts.databaseUrl) {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: migrationsFolder() });
    return { db, close: () => pool.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  let dir: string | undefined;
  if (opts.dataDir) {
    dir = path.join(opts.dataDir, 'pg');
    mkdirSync(dir, { recursive: true });
  }
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { db, close: () => client.close() };
}
