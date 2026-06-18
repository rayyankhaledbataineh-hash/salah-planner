import type { HttpFunction } from '@google-cloud/functions-framework';
import { authorizeFromEnv } from './auth';
import { schedulePrayers } from './core';
import { notify } from './notify';

/**
 * Cloud entry point. Cloud Scheduler sends an authenticated POST here once a day;
 * we authorize from environment variables (Secret Manager), run the same
 * scheduling routine as the local CLI, and report success/failure via HTTP status
 * so a failed run shows up as a failed job in the Scheduler console.
 */
export const updatePrayerTimes: HttpFunction = async (_req, res) => {
  try {
    const auth = authorizeFromEnv();
    const summary = await schedulePrayers(auth);
    console.log(summary);
    res.status(200).send(summary);
  } catch (err) {
    console.error('Error:', err);
    // Goes to Cloud Logging; also keeps notify()'s interface consistent.
    await notify('Salah Planner', String((err as Error)?.message ?? err));
    res.status(500).send(`Failed: ${(err as Error)?.message ?? err}`);
  }
};
