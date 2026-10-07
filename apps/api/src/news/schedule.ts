import type { RundownService } from './service';

/** India has one time zone and no daylight saving, so its clock is always UTC plus this. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** The rundown is made at five in the afternoon, India time. */
const RUN_HOUR = 17;
/** A long timer is late after the computer sleeps, so the schedule looks at the clock at least this often. */
const MAX_WAIT_MS = 15 * 60 * 1000;

/** A date whose UTC fields read as the clock in India. */
const inIndia = (now: Date) => new Date(now.getTime() + IST_OFFSET_MS);

/** The calendar day in India, as YYYY-MM-DD. */
export function istDate(now: Date): string {
  return inIndia(now).toISOString().slice(0, 10);
}

/** True from 17:00 India time until midnight. */
export function isPastRunTime(now: Date): boolean {
  return inIndia(now).getUTCHours() >= RUN_HOUR;
}

/** The next 17:00 India time strictly after `now`. */
export function nextRunAt(now: Date): Date {
  const india = inIndia(now);
  const today = Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate(), RUN_HOUR) - IST_OFFSET_MS;
  return new Date(today > now.getTime() ? today : today + DAY_MS);
}

/**
 * Makes the rundown every day at 17:00 India time, and at once when the server starts after that
 * hour on a day that has none yet. Returns a function that stops it.
 */
export function startSchedule(service: RundownService, log: (message: string) => void, now: () => Date = () => new Date()): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let due = nextRunAt(now());

  const run = (why: string) => {
    log(`Making the rundown for ${istDate(now())} (${why})`);
    void service.generate().then(() => log(service.lastError ? `The rundown was not made: ${service.lastError}` : 'The rundown is ready'));
  };

  const tick = () => {
    if (stopped) return;
    if (now().getTime() >= due.getTime()) {
      due = nextRunAt(now());
      run('daily schedule');
    }
    timer = setTimeout(tick, Math.min(MAX_WAIT_MS, Math.max(1000, due.getTime() - now().getTime())));
    timer.unref();
  };

  void service
    .byDate(istDate(now()))
    .then((today) => {
      if (!stopped && !today && isPastRunTime(now())) run('none yet today');
    })
    .catch(() => undefined);
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
