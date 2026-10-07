import { rundownSchema, type Rundown } from '@studio/shared';
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { rundowns } from '../db/schema';
import { istDate } from './schedule';
import type { Collected } from './sources';
import type { Writer } from './writer';

/** Where rundowns are kept: one per day. */
export interface RundownStore {
  save(rundown: Rundown, now: Date): Promise<void>;
  /** The stored value for a day, unchecked: it may have been written by older code. */
  get(date: string): Promise<unknown>;
  /** The newest few stored values, newest first. */
  recent(limit: number): Promise<unknown[]>;
  dates(limit: number): Promise<string[]>;
}

export function dbStore(db: Db): RundownStore {
  return {
    async save(rundown, now) {
      await db
        .insert(rundowns)
        .values({ date: rundown.date, data: rundown })
        .onConflictDoUpdate({ target: rundowns.date, set: { data: rundown, createdAt: now } });
    },
    get: async (date) => (await db.select().from(rundowns).where(eq(rundowns.date, date)))[0]?.data,
    recent: async (limit) => (await db.select().from(rundowns).orderBy(desc(rundowns.date)).limit(limit)).map((row) => row.data),
    dates: async (limit) => (await db.select({ date: rundowns.date }).from(rundowns).orderBy(desc(rundowns.date)).limit(limit)).map((row) => row.date),
  };
}

/**
 * Keeps rundowns only while the server runs. End-to-end tests use it, so a rundown made from test
 * news never lands in the database beside the real ones.
 */
export function memoryStore(): RundownStore {
  const byDate = new Map<string, Rundown>();
  const newestFirst = () => [...byDate.keys()].sort().reverse();
  return {
    save: async (rundown) => void byDate.set(rundown.date, rundown),
    get: async (date) => byDate.get(date),
    recent: async (limit) => newestFirst().slice(0, limit).map((date) => byDate.get(date)),
    dates: async (limit) => newestFirst().slice(0, limit),
  };
}

/** Makes, stores and reads the daily rundowns. One is made at a time. */
export class RundownService {
  private running: Promise<void> | null = null;
  /** Why the last attempt stored nothing, for the host to read. Null after a success. */
  lastError: string | null = null;

  constructor(
    private readonly store: RundownStore,
    private readonly collect: (now: Date) => Promise<Collected>,
    private readonly writer: Writer,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get generating(): boolean {
    return this.running !== null;
  }

  /** Makes today's rundown, replacing the one already stored for today. A second call joins the first. */
  generate(): Promise<void> {
    this.running ??= this.make().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async make(): Promise<void> {
    try {
      const now = this.now();
      const collected = await this.collect(now);
      if (collected.items.length === 0) {
        // Nothing to make a show from. Whatever was stored before stays.
        this.lastError = 'No news source could be reached. Check the internet connection and try again.';
        return;
      }
      await this.store.save(await this.writer.write(collected, istDate(now), now), now);
      this.lastError = null;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message.slice(0, 200) : 'The rundown could not be made';
    }
  }

  /** A stored rundown is read back through the schema, so one saved by older code cannot break the studio. */
  private read(data: unknown): Rundown | null {
    const parsed = rundownSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  }

  async latest(): Promise<Rundown | null> {
    for (const data of await this.store.recent(5)) {
      const rundown = this.read(data);
      if (rundown) return rundown;
    }
    return null;
  }

  async byDate(date: string): Promise<Rundown | null> {
    return this.read(await this.store.get(date));
  }

  /** Days that have a rundown, newest first. */
  dates(): Promise<string[]> {
    return this.store.dates(60);
  }
}
