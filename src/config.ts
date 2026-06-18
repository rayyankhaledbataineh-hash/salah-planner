import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from the project root (one level up from src/).
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/** Path to the Google OAuth credentials file. */
export const CREDENTIALS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ?? './credentials.json';

/** Path to the cached OAuth token file. */
export const TOKEN_PATH =
  process.env.GOOGLE_TOKEN_PATH ?? './token.json';

/**
 * How many days ahead to keep scheduled. Each run tops the window back up, so
 * the script self-heals as long as it runs at least once every DAYS_AHEAD days.
 * Kept at 3: the cloud job runs daily, and a 3-day window gives a buffer so a
 * single missed/failed run never leaves a gap.
 */
export const DAYS_AHEAD = Number(process.env.DAYS_AHEAD) || 3;

/**
 * Optional fixed coordinates. When set, the IP-based geolocation is skipped
 * entirely — useful if you're behind a VPN or want deterministic results.
 */
export const LATITUDE = process.env.LATITUDE
  ? Number(process.env.LATITUDE)
  : undefined;

export const LONGITUDE = process.env.LONGITUDE
  ? Number(process.env.LONGITUDE)
  : undefined;

/** IANA timezone override (e.g. "America/Chicago"). Used with fixed coords. */
export const TIMEZONE = process.env.TIMEZONE ?? undefined;

/** Path to the log file (for rotation). */
export const LOG_PATH =
  process.env.LOG_PATH ?? path.resolve(__dirname, '..', 'salah-planner.log');

/** Maximum log file size in bytes before rotation (~100 KB). */
export const LOG_MAX_BYTES = 100_000;

/** Number of lines to keep when rotating. */
export const LOG_KEEP_LINES = 500;
