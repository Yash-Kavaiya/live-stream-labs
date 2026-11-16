import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Db;
  close(): Promise<void>;
  /**
   * True while this process holds the named lock. Only one process among many holds it, which is
   * how a job that must run once (the daily rundown) picks its runner. With embedded PGlite there
   * is only ever one process, so it always holds it.
   */
  holdsLock(name: string): Promise<boolean>;
}

/** A stable 32-bit key for a Postgres advisory lock. */
function lockKey(name: string): number {
  let hash = 0;
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0;
  return hash;
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
    const pool = new pg.Pool({
      connectionString: opts.databaseUrl,
      max: 10,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    });
    // A connection the database drops while idle raises an error on the pool; without a handler
    // that would crash the process. The pool replaces the connection on the next query.
    pool.on('error', (err) => console.error(`[db] idle connection lost: ${err.message}`));
    const db = drizzle(pool, { schema });
    // Several instances may start at once: one applies the migrations while the others wait.
    const migrator = await pool.connect();
    try {
      await migrator.query('select pg_advisory_lock($1)', [lockKey('migrations')]);
      await migrate(db, { migrationsFolder: migrationsFolder() });
    } finally {
      await migrator.query('select pg_advisory_unlock($1)', [lockKey('migrations')]).catch(() => undefined);
      migrator.release();
    }

    // Advisory locks belong to a session, so each one is held on a connection of its own.
    const held = new Map<string, PoolClient>();
    const holdsLock = async (name: string): Promise<boolean> => {
      const client = held.get(name);
      if (client) {
        try {
          await client.query('select 1');
          return true;
        } catch {
          // The connection died, and the lock with it.
          held.delete(name);
          client.release(true);
        }
      }
      let next: PoolClient | undefined;
      try {
        next = await pool.connect();
        next.on('error', () => undefined);
        const { rows } = await next.query<{ ok: boolean }>('select pg_try_advisory_lock($1) as ok', [lockKey(name)]);
        if (rows[0]?.ok) {
          held.set(name, next);
          return true;
        }
        next.release();
        return false;
      } catch {
        next?.release(true);
        return false;
      }
    };
    return {
      db,
      holdsLock,
      close: async () => {
        for (const client of held.values()) client.release(true);
        await pool.end();
      },
    };
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
  return { db, close: () => client.close(), holdsLock: async () => true };
}
