import axios from 'axios';
import * as fs from 'fs';
import { LATITUDE, LONGITUDE, TIMEZONE, LOCATION_FILE } from './config';
import { withRetry } from './retry';

export interface Location {
  latitude: number;
  longitude: number;
  timezone: string; // IANA zone, e.g. "America/New_York"
  city: string;
  country: string;
}

/**
 * Determines the user's location, in priority order:
 *   1. LATITUDE / LONGITUDE in the environment (e.g. .env) — an explicit
 *      override, handy behind a VPN or for deterministic local runs.
 *   2. A committed location.json — the source of truth for the autonomous
 *      cloud job, refreshed whenever the phone Shortcut reports you've moved.
 *   3. IP-based geolocation via ipwho.is — the local default when nothing else
 *      is set (CI runners can't use this: their IP is a data-center).
 */
export async function getLocation(): Promise<Location> {
  if (LATITUDE != null && LONGITUDE != null) {
    return {
      latitude: LATITUDE,
      longitude: LONGITUDE,
      timezone: TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      city: 'Manual',
      country: 'Manual',
    };
  }

  const saved = readLocationFile();
  if (saved) return saved;

  const url = 'https://ipwho.is/?fields=success,message,latitude,longitude,timezone,city,country';
  const res = await withRetry(() => axios.get(url));

  if (!res.data.success) {
    throw new Error(
      `Location lookup failed: ${res.data.message ?? 'unknown error'}`
    );
  }

  return {
    latitude: res.data.latitude,
    longitude: res.data.longitude,
    timezone: res.data.timezone?.id ?? res.data.timezone,
    city: res.data.city,
    country: res.data.country,
  };
}

/**
 * Reads the committed location.json written by updateLocation.ts. Returns
 * undefined (rather than throwing) if the file is missing or malformed, so a
 * bad/absent file simply falls through to IP geolocation instead of breaking a
 * run. The stored `label` is split back into city/country for logging.
 */
function readLocationFile(): Location | undefined {
  try {
    if (!fs.existsSync(LOCATION_FILE)) return undefined;

    const data = JSON.parse(fs.readFileSync(LOCATION_FILE, 'utf-8'));
    if (
      typeof data.latitude !== 'number' ||
      typeof data.longitude !== 'number' ||
      typeof data.timezone !== 'string' ||
      !data.timezone
    ) {
      return undefined;
    }

    const [city, country] = String(data.label ?? '')
      .split(',')
      .map((s: string) => s.trim());

    return {
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      city: city || 'Saved location',
      country: country || '',
    };
  } catch {
    return undefined;
  }
}
