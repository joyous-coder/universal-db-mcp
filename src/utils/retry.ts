/**
 * Retry utility with exponential backoff
 * Used by database adapters for transient connection errors.
 */

export interface RetryOptions {
  /** Maximum number of retries (default: 1) */
  retries?: number;
  /** Base delay in ms; delay = baseDelayMs * 2^attempt (default: 50) */
  baseDelayMs?: number;
  /** Custom error classifier; default uses isConnectionErrorMessage */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'isRetryable'>> = {
  retries: 1,
  baseDelayMs: 50,
};

/**
 * Check if an error message indicates a transient connection problem.
 * Covers common patterns across MySQL, PostgreSQL, and generic socket errors.
 */
export function isConnectionErrorMessage(msg: string): boolean {
  return /closed state|ECONNRESET|EPIPE|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Connection lost|Connection terminated|ECONNREFUSED|57P01|57P03|08003|08006/.test(msg);
}

/**
 * Execute fn with retry on transient connection errors.
 * Throws if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const isRetryable = options.isRetryable ?? ((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    return isConnectionErrorMessage(msg);
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === opts.retries || !isRetryable(err)) {
        throw err;
      }
      const delay = opts.baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}