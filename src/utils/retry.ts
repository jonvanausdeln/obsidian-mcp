import type { RetryOptions } from '../types/obsidian.js';
import { categorizeError, isRetryableError } from '../obsidian/errorHandler.js';
import type winston from 'winston';

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 5000,
  shouldRetry: (error: unknown) => {
    const categorized = categorizeError(error);
    return isRetryableError(categorized);
  },
};

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(attempt: number, baseDelay: number, maxDelay: number): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * 0.3 * exponentialDelay; // Add up to 30% jitter
  return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>,
  logger?: winston.Logger
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!opts.shouldRetry(error)) {
        logger?.debug('Error is not retryable, throwing immediately', { error });
        throw error;
      }

      // Check if we've exhausted attempts
      if (attempt >= opts.maxAttempts) {
        logger?.warn(`All ${opts.maxAttempts} retry attempts exhausted`, { error });
        throw error;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay);
      logger?.debug(`Retry attempt ${attempt}/${opts.maxAttempts} after ${delay}ms`, {
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Retry manager class for more complex retry scenarios
 */
export class RetryManager {
  private options: Required<RetryOptions>;
  private logger: winston.Logger | undefined;

  constructor(options?: Partial<RetryOptions>, logger?: winston.Logger) {
    this.options = { ...DEFAULT_RETRY_OPTIONS, ...options };
    this.logger = logger;
  }

  /**
   * Execute function with retry logic
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return retryWithBackoff(fn, this.options, this.logger);
  }

  /**
   * Update retry options
   */
  setOptions(options: Partial<RetryOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): Required<RetryOptions> {
    return { ...this.options };
  }
}
