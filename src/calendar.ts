import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrayerTimings } from './prayerTimes';
import { addDays } from './dates';
import { withRetry } from './retry';

const REMINDER_MINUTES = 10;

// Tag attached to every event we create, so re-runs can recognise our own
// events and avoid creating duplicates.
const TAG_KEY = 'salahPlanner';

// Each prayer's valid window runs from its start time until the next boundary.
// Fajr ends at Sunrise; Isha ends at midnight (00:00) so it doesn't spill onto
// the next day's calendar view. 'MIDNIGHT' is a sentinel handled below.
interface PrayerWindow {
  name: string;
  start: keyof PrayerTimings;
  end: keyof PrayerTimings | 'MIDNIGHT';
}

const WINDOWS: PrayerWindow[] = [
  { name: 'Fajr', start: 'Fajr', end: 'Sunrise' },
  { name: 'Dhuhr', start: 'Dhuhr', end: 'Asr' },
  { name: 'Asr', start: 'Asr', end: 'Maghrib' },
  { name: 'Maghrib', start: 'Maghrib', end: 'Isha' },
  { name: 'Isha', start: 'Isha', end: 'MIDNIGHT' },
];

/**
 * Creates one calendar event per prayer window on the user's primary calendar
 * for the given day (`date` is "YYYY-MM-DD"). Re-running is safe: prayers
 * already scheduled for that day are skipped.
 */
export async function createPrayerEvents(
  auth: OAuth2Client,
  timings: PrayerTimings,
  timeZone: string,
  date: string
): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth });
  const today = date; // the day we're scheduling
  const tomorrow = addDays(today, 1);

  const alreadyScheduled = await getScheduledPrayers(calendar, today);

  for (const w of WINDOWS) {
    if (alreadyScheduled.has(w.name)) {
      console.log(`• ${today} ${w.name} already scheduled — skipping.`);
      continue;
    }

    const startTime = cleanTime(timings[w.start]); // "HH:MM"

    // Isha ends at midnight: 00:00 on the next calendar day. For every other
    // prayer the end is another timing; if it isn't after the start it would
    // cross midnight, so it belongs on the next day.
    let endTime: string;
    let endDate: string;
    if (w.end === 'MIDNIGHT') {
      endTime = '00:00';
      endDate = tomorrow;
    } else {
      endTime = cleanTime(timings[w.end]);
      endDate = toMinutes(endTime) <= toMinutes(startTime) ? tomorrow : today;
    }

    await withRetry(() =>
      calendar.events.insert({
        calendarId: 'primary',
        requestBody: {
          summary: w.name,
          start: { dateTime: `${today}T${startTime}:00`, timeZone },
          end: { dateTime: `${endDate}T${endTime}:00`, timeZone },
          reminders: {
            useDefault: false,
            overrides: [{ method: 'popup', minutes: REMINDER_MINUTES }],
          },
          extendedProperties: {
            private: { [TAG_KEY]: today, prayer: w.name },
          },
        },
      })
    );

    console.log(`✓ ${today} ${w.name}: ${startTime}–${endTime}`);
  }
}

/**
 * Returns the set of prayers we have already created events for on `dateKey`,
 * identified by our private tag.
 */
async function getScheduledPrayers(
  calendar: ReturnType<typeof google.calendar>,
  dateKey: string
): Promise<Set<string>> {
  const res = await withRetry(() =>
    calendar.events.list({
      calendarId: 'primary',
      privateExtendedProperty: [`${TAG_KEY}=${dateKey}`],
      singleEvents: true,
    })
  );

  const scheduled = new Set<string>();
  for (const event of res.data.items ?? []) {
    const prayer = event.extendedProperties?.private?.prayer;
    if (prayer) scheduled.add(prayer);
  }
  return scheduled;
}

/**
 * Aladhan returns times like "05:12" or sometimes "05:12 (EDT)". Strips any
 * suffix and normalises to a zero-padded "HH:MM" string.
 */
function cleanTime(raw: string): string {
  const t = raw.trim().split(' ')[0];
  const match = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!match) {
    throw new Error(`Could not parse prayer time: "${raw}"`);
  }
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
