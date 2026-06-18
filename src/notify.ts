import { execFile } from 'child_process';

/**
 * Surfaces a failure message. On macOS (local runs) it posts a desktop
 * notification via osascript so problems don't disappear silently into the log.
 * Anywhere else (e.g. the Linux Cloud Functions runtime) osascript doesn't
 * exist, so it falls back to console.error — which the cloud routes to Cloud
 * Logging, visible in the GCP Console. Best-effort: never throws.
 */
export function notify(title: string, message: string): Promise<void> {
  if (process.platform !== 'darwin') {
    console.error(`${title}: ${message}`);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const script = `display notification ${quote(message)} with title ${quote(
      title
    )} sound name "Basso"`;
    execFile('osascript', ['-e', script], () => resolve());
  });
}

// AppleScript string literal: wrap in double quotes, escape backslashes/quotes.
function quote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
