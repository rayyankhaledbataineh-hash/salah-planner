import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import { getLocation } from './location';
import { getPrayerTimesForDate } from './prayerTimes';
import { createPrayerEvents } from './calendar';
import { todayInZone, addDays } from './dates';
import { DAYS_AHEAD, LOG_PATH, LOG_MAX_BYTES, LOG_KEEP_LINES } from './config';

/**
 * The shared scheduling routine. Given an authorized client, it resolves the
 * location, then tops up a rolling window of prayer events (DAYS_AHEAD days)
 * on the user's primary calendar. Both the local entry point (index.ts) and the
 * cloud entry point (cloudFunction.ts) call this, so the business logic lives in
 * exactly one place.
 *
 * Returns a short human-readable summary, used for the cloud HTTP response.
 */
export async function schedulePrayers(auth: OAuth2Client): Promise<string> {
  const location = await getLocation();
  console.log(
    `Location: ${location.city}, ${location.country} (${location.timezone})`
  );

  const today = todayInZone(location.timezone);

  for (let i = 0; i < DAYS_AHEAD; i++) {
    const date = addDays(today, i);
    const { timings, timezone } = await getPrayerTimesForDate(
      location.latitude,
      location.longitude,
      date
    );
    await createPrayerEvents(auth, timings, timezone, date);
  }

  return `Scheduled prayers for ${DAYS_AHEAD} day(s) starting ${today} (${location.timezone}).`;
}

/**
 * Keeps the local log file from growing unbounded. If it exceeds LOG_MAX_BYTES,
 * trims it to the last LOG_KEEP_LINES lines. Best-effort and local-only: the
 * cloud filesystem is read-only, so any write error is swallowed (in the cloud,
 * logging goes to Cloud Logging via stdout/stderr instead of a file).
 */
export function rotateLogIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_PATH)) return;
    if (fs.statSync(LOG_PATH).size <= LOG_MAX_BYTES) return;

    const lines = fs.readFileSync(LOG_PATH, 'utf-8').split('\n');
    const trimmed = lines.slice(-LOG_KEEP_LINES).join('\n');
    fs.writeFileSync(LOG_PATH, trimmed);
  } catch {
    // Non-fatal: never let log housekeeping break a run.
  }
}
