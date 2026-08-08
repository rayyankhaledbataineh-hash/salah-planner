import axios from 'axios';
import * as fs from 'fs';
import { getPrayerTimesForDate } from './prayerTimes';
import { todayInZone } from './dates';
import { LOCATION_FILE } from './config';
import { withRetry } from './retry';

/**
 * Persists a new "current location" for the autonomous cloud job.
 *
 * Reads raw GPS coordinates from LOCATION_LAT / LOCATION_LNG (sent by the phone
 * Shortcut through a manual workflow run) and writes location.json. The daily
 * scheduled run then reuses that file until the next time you move, so location
 * stays hands-off with nothing hardcoded. GPS is only ever captured when you tap
 * the Shortcut — nothing runs in the background, and only the latest location is
 * stored (this overwrites; there's no trail).
 *
 * The IANA timezone is taken from the Aladhan API — the same source the prayer
 * times come from — so the two can never disagree, and no timezone database is
 * needed. The city label is a best-effort reverse geocode, purely cosmetic.
 */

function parseCoord(
  raw: string | undefined,
  name: string,
  min: number,
  max: number
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(
      `${name} must be a number in [${min}, ${max}], got: ${raw ?? '(unset)'}`
    );
  }
  return n;
}

/** Best-effort human label like "Greensburg, US". Never throws. */
async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | undefined> {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
    const res = await withRetry(() => axios.get(url));
    const city =
      res.data.city || res.data.locality || res.data.principalSubdivision;
    const country = res.data.countryCode || res.data.countryName;
    if (city && country) return `${city}, ${country}`;
    if (city) return city;
  } catch {
    // Cosmetic only — fall back to a timezone-derived label below.
  }
  return undefined;
}

/** Fallback label from a timezone, e.g. "America/New_York" -> "New York". */
function labelFromTimezone(tz: string): string {
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

async function main() {
  const latitude = parseCoord(process.env.LOCATION_LAT, 'LOCATION_LAT', -90, 90);
  const longitude = parseCoord(
    process.env.LOCATION_LNG,
    'LOCATION_LNG',
    -180,
    180
  );

  // Ask Aladhan for today's timings just to read back the timezone it reports
  // for these coordinates; a date is required but which day doesn't matter here.
  const { timezone } = await getPrayerTimesForDate(
    latitude,
    longitude,
    todayInZone('UTC')
  );

  const label =
    (await reverseGeocode(latitude, longitude)) ?? labelFromTimezone(timezone);

  const record = {
    latitude,
    longitude,
    timezone,
    label,
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(LOCATION_FILE, JSON.stringify(record, null, 2) + '\n');
  console.log(
    `Updated location -> ${label} (${latitude}, ${longitude}) ${timezone}`
  );
}

main().catch((err) => {
  console.error('Failed to update location:', err);
  process.exit(1);
});
