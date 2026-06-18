import { AxiosError } from 'axios';

/**
 * Retries `fn` up to `maxAttempts` times on transient errors, using
 * exponential backoff with jitter.
 *
 * Transient errors: network failures, HTTP 429 (rate limit), and 5xx.
 * Everything else (4xx, bad JSON, etc.) is thrown immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isTransient(err) || attempt === maxAttempts) {
        throw err;
      }

      const delay = baseDelayMs * 2 ** (attempt - 1) + Math.random() * 500;
      console.log(
        `  ↻ Attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(
          delay
        )}ms…`
      );
      await sleep(delay);
    }
  }

  // Unreachable, but satisfies the type checker.
  throw lastError;
}

function isTransient(err: unknown): boolean {
  if (err instanceof AxiosError) {
    // No response at all → network error / timeout.
    if (!err.response) return true;
    const status = err.response.status;
    return status === 429 || status >= 500;
  }

  // Google API client errors surface as { code, errors[] } objects.
  const code = (err as Record<string, unknown>)?.code;
  if (typeof code === 'number') {
    return code === 429 || code >= 500;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
