import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { PrayerTimings } from './prayerTimes';
import { addDays } from './dates';
import { withRetry } from './retry';

const REMINDER_MINUTES = 10;

// Tag attached to every event we create, so re-runs can recognise our own
// events and avoid creating duplicates.
const TAG_KEY = 'salahPlanner';

// Each event also stores the coordinates it was scheduled for. If the current
// location is farther than this from those coordinates, the event's times are
// wrong for where the user actually is, so it gets deleted and rescheduled.
// 50 km is well past IP-geolocation jitter but catches any real relocation.
const RELOCATE_KM = 50;

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

/** An already-created event for one prayer, with where it was scheduled for. */
interface ScheduledEvent {
  id: string;
  latitude?: number;
  longitude?: number;
}

/**
 * Creates one calendar event per prayer window on the user's primary calendar
 * for the given day (`date` is "YYYY-MM-DD"). Re-running is safe: prayers
 * already scheduled for that day are skipped — unless they were scheduled for
 * a different location (beyond RELOCATE_KM), in which case they are deleted
 * and recreated with times for the current coordinates.
 */
export async function createPrayerEvents(
  auth: OAuth2Client,
  timings: PrayerTimings,
  timeZone: string,
  date: string,
  coords: { latitude: number; longitude: number }
): Promise<void> {
  const calendar = google.calendar({ version: 'v3', auth });
  const today = date; // the day we're scheduling
  const tomorrow = addDays(today, 1);

  const existing = await getScheduledPrayers(calendar, today);

  for (const w of WINDOWS) {
    const prev = existing.get(w.name);
    if (prev) {
      // Events created by older versions have no stored coordinates; leave
      // those alone rather than churn the whole calendar on upgrade.
      const moved =
        prev.latitude != null &&
        prev.longitude != null &&
        kmBetween(prev.latitude, prev.longitude, coords.latitude, coords.longitude) >
          RELOCATE_KM;

      if (!moved) {
        console.log(`• ${today} ${w.name} already scheduled — skipping.`);
        continue;
      }

      await withRetry(() =>
        calendar.events.delete({ calendarId: 'primary', eventId: prev.id })
      );
      console.log(
        `↻ ${today} ${w.name} was scheduled for another location — rescheduling.`
      );
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
            private: {
              [TAG_KEY]: today,
              prayer: w.name,
              lat: coords.latitude.toFixed(4),
              lng: coords.longitude.toFixed(4),
            },
          },
        },
      })
    );

    console.log(`✓ ${today} ${w.name}: ${startTime}–${endTime}`);
  }
}

/**
 * Returns the events we have already created for `dateKey`, keyed by prayer
 * name and identified by our private tag, including the coordinates each one
 * was scheduled for (absent on events created by older versions).
 */
async function getScheduledPrayers(
  calendar: ReturnType<typeof google.calendar>,
  dateKey: string
): Promise<Map<string, ScheduledEvent>> {
  const res = await withRetry(() =>
    calendar.events.list({
      calendarId: 'primary',
      privateExtendedProperty: [`${TAG_KEY}=${dateKey}`],
      singleEvents: true,
    })
  );

  const scheduled = new Map<string, ScheduledEvent>();
  for (const event of res.data.items ?? []) {
    const props = event.extendedProperties?.private;
    const prayer = props?.prayer;
    if (!prayer || !event.id) continue;

    scheduled.set(prayer, {
      id: event.id,
      latitude: props.lat ? Number(props.lat) : undefined,
      longitude: props.lng ? Number(props.lng) : undefined,
    });
  }
  return scheduled;
}

/** Great-circle (haversine) distance between two coordinates, in km. */
function kmBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
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
