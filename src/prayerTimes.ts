import axios from 'axios';
import { withRetry } from './retry';

/** The Aladhan timings we need to build prayer windows. */
export interface PrayerTimings {
  Fajr: string;
  Sunrise: string;
  Dhuhr: string;
  Asr: string;
  Maghrib: string;
  Isha: string;
}

export interface PrayerInfo {
  timings: PrayerTimings;
  timezone: string; // IANA zone the times are expressed in
}

/**
 * Fetches prayer times for a latitude/longitude on a specific date using the
 * Aladhan API (ISNA calculation, method=2). `date` is a "YYYY-MM-DD" string.
 * Returns the timings plus the timezone they are expressed in.
 */
export async function getPrayerTimesForDate(
  latitude: number,
  longitude: number,
  date: string
): Promise<PrayerInfo> {
  const [year, month, day] = date.split('-');
  const aladhanDate = `${day}-${month}-${year}`; // Aladhan wants DD-MM-YYYY

  const url = `https://api.aladhan.com/v1/timings/${aladhanDate}?latitude=${latitude}&longitude=${longitude}&method=2`;
  const response = await withRetry(() => axios.get(url));
  const data = response.data.data;
  const t = data.timings;

  return {
    timings: {
      Fajr: t.Fajr,
      Sunrise: t.Sunrise,
      Dhuhr: t.Dhuhr,
      Asr: t.Asr,
      Maghrib: t.Maghrib,
      Isha: t.Isha,
    },
    timezone: data.meta.timezone,
  };
}
