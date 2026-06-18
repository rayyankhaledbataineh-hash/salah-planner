import axios from 'axios';
import { LATITUDE, LONGITUDE, TIMEZONE } from './config';
import { withRetry } from './retry';

export interface Location {
  latitude: number;
  longitude: number;
  timezone: string; // IANA zone, e.g. "America/New_York"
  city: string;
  country: string;
}

/**
 * Determines the user's approximate location. If LATITUDE / LONGITUDE are set
 * in the environment (via .env), those are used directly — handy behind a VPN.
 * Otherwise falls back to IP-based geolocation via ipwho.is (free, HTTPS, no
 * API key required).
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
