import { authorize } from './auth';
import { schedulePrayers, rotateLogIfNeeded } from './core';
import { notify } from './notify';

// Local entry point. Run with `npm start`. Uses the interactive/file-based auth
// flow and the shared scheduling routine in core.ts. The cloud entry point lives
// in cloudFunction.ts and reuses the same schedulePrayers().
async function main() {
  rotateLogIfNeeded();

  const auth = await authorize();
  console.log('Authorized.');

  const summary = await schedulePrayers(auth);
  console.log(summary);
  console.log('Done — check your Google Calendar.');
}

main().catch(async (err) => {
  console.error('Error:', err);

  // Surface failures as a macOS notification so they don't go unnoticed.
  const isAuth = String(err?.message ?? err).includes('invalid_grant');
  const message = isAuth
    ? 'Google login expired. Open Terminal and re-run to sign in again.'
    : "Couldn't update your prayer times. Check your connection and re-run.";
  await notify('Salah Planner', message);

  process.exit(1);
});
