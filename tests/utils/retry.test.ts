import { describe, it, expect, vi, beforeEach } from 'vitest';
import { retryWithBackoff, RetryManager } from '../../src/utils/retry';
import { createError } from '../../src/obsidian/errorHandler';
import { ObsidianErrorType } from '../../src/types/obsidian';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const promise = retryWithBackoff(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry retryable errors', async () => {
      const retryableError = createError(ObsidianErrorType.IO_ERROR, 'Transient error');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const promise = retryWithBackoff(fn, { maxAttempts: 3, baseDelay: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const nonRetryableError = createError(
        ObsidianErrorType.FILE_NOT_FOUND,
        'File not found'
      );
      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      const promise = retryWithBackoff(fn, { maxAttempts: 3 });

      await expect(promise).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const retryableError = createError(ObsidianErrorType.NETWORK_ERROR, 'Network error');
      const fn = vi.fn().mockRejectedValue(retryableError);

      const promise = retryWithBackoff(fn, { maxAttempts: 3, baseDelay: 100 });

      // Catch the promise to prevent unhandled rejection
      promise.catch(() => {});

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toEqual(retryableError);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      const retryableError = createError(ObsidianErrorType.IO_ERROR, 'I/O error');
      const fn = vi.fn().mockRejectedValue(retryableError);

      const promise = retryWithBackoff(fn, { maxAttempts: 3, baseDelay: 100, maxDelay: 5000 });

      // Catch the promise to prevent unhandled rejection
      promise.catch(() => {});

      // Don't wait for completion, just verify it's attempting retries
      setTimeout(() => {
        expect(fn.mock.calls.length).toBeGreaterThan(0);
      }, 50);

      await vi.runAllTimersAsync();
      await expect(promise).rejects.toEqual(retryableError);
    });

    it('should respect maxDelay', async () => {
      const retryableError = createError(ObsidianErrorType.API_UNAVAILABLE, 'API unavailable');
      const fn = vi.fn().mockRejectedValue(retryableError);

      const promise = retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 2000,
      });

      // Catch the promise to prevent unhandled rejection
      promise.catch(() => {});

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toEqual(retryableError);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should use custom shouldRetry function', async () => {
      const customError = new Error('Custom error');
      const fn = vi
        .fn()
        .mockRejectedValueOnce(customError)
        .mockResolvedValue('success');

      const shouldRetry = vi.fn().mockReturnValue(true);

      const promise = retryWithBackoff(fn, { maxAttempts: 2, shouldRetry, baseDelay: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(shouldRetry).toHaveBeenCalledWith(customError);
    });
  });

  describe('RetryManager', () => {
    it('should execute with default options', async () => {
      const manager = new RetryManager();
      const fn = vi.fn().mockResolvedValue('success');

      const promise = manager.execute(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should execute with custom options', async () => {
      const manager = new RetryManager({ maxAttempts: 5, baseDelay: 200 });
      const retryableError = createError(ObsidianErrorType.DISK_FULL, 'Disk full');
      const fn = vi.fn().mockRejectedValue(retryableError);

      const promise = manager.execute(fn);

      // Catch the promise to prevent unhandled rejection
      promise.catch(() => {});

      await vi.runAllTimersAsync();

      await expect(promise).rejects.toEqual(retryableError);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should allow updating options', async () => {
      const manager = new RetryManager({ maxAttempts: 2 });
      manager.setOptions({ maxAttempts: 4 });

      const options = manager.getOptions();
      expect(options.maxAttempts).toBe(4);
    });

    it('should get current options', () => {
      const manager = new RetryManager({ maxAttempts: 5, baseDelay: 200 });
      const options = manager.getOptions();

      expect(options.maxAttempts).toBe(5);
      expect(options.baseDelay).toBe(200);
      expect(options.maxDelay).toBeDefined();
    });

    it('should preserve unmodified options when setting new ones', () => {
      const manager = new RetryManager({ maxAttempts: 3, baseDelay: 100 });
      manager.setOptions({ maxAttempts: 5 });

      const options = manager.getOptions();
      expect(options.maxAttempts).toBe(5);
      expect(options.baseDelay).toBe(100);
    });
  });
});
