import { authorizeFromEnv } from './auth';
import { schedulePrayers } from './core';

// Entry point for scheduled CI runs (e.g. GitHub Actions). Authorizes from
// environment variables (injected from repository secrets), runs the shared
// scheduling routine once, then exits. A non-zero exit marks the CI run as
// failed so it's visible in the Actions UI.
(async () => {
  const auth = authorizeFromEnv();
  const summary = await schedulePrayers(auth);
  console.log(summary);
})().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
