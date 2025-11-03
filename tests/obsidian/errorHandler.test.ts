import { describe, it, expect } from 'vitest';
import {
  createError,
  categorizeError,
  isRetryableError,
  formatError,
} from '../../src/obsidian/errorHandler';
import { ObsidianErrorType } from '../../src/types/obsidian';

describe('errorHandler', () => {
  describe('createError', () => {
    it('should create a basic error', () => {
      const error = createError(ObsidianErrorType.FILE_NOT_FOUND, 'File not found');

      expect(error.type).toBe(ObsidianErrorType.FILE_NOT_FOUND);
      expect(error.message).toBe('File not found');
      expect(error.details).toBeUndefined();
    });

    it('should create error with details', () => {
      const error = createError(ObsidianErrorType.FILE_NOT_FOUND, 'File not found', {
        path: '/test/file.md',
        suggestedAction: 'Check the path',
      });

      expect(error.details?.path).toBe('/test/file.md');
      expect(error.details?.suggestedAction).toBe('Check the path');
    });
  });

  describe('categorizeError', () => {
    it('should categorize ENOENT as FILE_NOT_FOUND', () => {
      const nodeError: NodeJS.ErrnoException = new Error('File not found');
      nodeError.code = 'ENOENT';

      const error = categorizeError(nodeError, { path: '/test/file.md' });

      expect(error.type).toBe(ObsidianErrorType.FILE_NOT_FOUND);
      expect(error.details?.path).toBe('/test/file.md');
      expect(error.details?.suggestedAction).toContain('list_notes');
    });

    it('should categorize EACCES as PERMISSION_DENIED', () => {
      const nodeError: NodeJS.ErrnoException = new Error('Permission denied');
      nodeError.code = 'EACCES';

      const error = categorizeError(nodeError, { path: '/test/file.md' });

      expect(error.type).toBe(ObsidianErrorType.PERMISSION_DENIED);
      expect(error.details?.suggestedAction).toContain('permissions');
    });

    it('should categorize EPERM as PERMISSION_DENIED', () => {
      const nodeError: NodeJS.ErrnoException = new Error('Operation not permitted');
      nodeError.code = 'EPERM';

      const error = categorizeError(nodeError);

      expect(error.type).toBe(ObsidianErrorType.PERMISSION_DENIED);
    });

    it('should categorize ENOSPC as DISK_FULL', () => {
      const nodeError: NodeJS.ErrnoException = new Error('No space left');
      nodeError.code = 'ENOSPC';

      const error = categorizeError(nodeError);

      expect(error.type).toBe(ObsidianErrorType.DISK_FULL);
      expect(error.details?.suggestedAction).toContain('Free up disk space');
    });

    it('should categorize EISDIR as INVALID_PATH', () => {
      const nodeError: NodeJS.ErrnoException = new Error('Is a directory');
      nodeError.code = 'EISDIR';

      const error = categorizeError(nodeError, { path: '/test/dir' });

      expect(error.type).toBe(ObsidianErrorType.INVALID_PATH);
      expect(error.message).toContain('directory');
    });

    it('should categorize ENOTDIR as INVALID_PATH', () => {
      const nodeError: NodeJS.ErrnoException = new Error('Not a directory');
      nodeError.code = 'ENOTDIR';

      const error = categorizeError(nodeError);

      expect(error.type).toBe(ObsidianErrorType.INVALID_PATH);
    });

    it('should categorize unknown Node error as IO_ERROR', () => {
      const nodeError: NodeJS.ErrnoException = new Error('Unknown error');
      nodeError.code = 'EUNKNOWN';

      const error = categorizeError(nodeError);

      expect(error.type).toBe(ObsidianErrorType.IO_ERROR);
    });

    it('should categorize axios 401 as AUTHENTICATION_ERROR', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 401, statusText: 'Unauthorized' },
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.AUTHENTICATION_ERROR);
      expect(error.details?.suggestedAction).toContain('API_KEY');
    });

    it('should categorize axios 403 as AUTHENTICATION_ERROR', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 403, statusText: 'Forbidden' },
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.AUTHENTICATION_ERROR);
    });

    it('should categorize axios 404 as FILE_NOT_FOUND', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 404, statusText: 'Not Found' },
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.FILE_NOT_FOUND);
    });

    it('should categorize axios other status as API_ERROR', () => {
      const axiosError = {
        isAxiosError: true,
        response: { status: 500, statusText: 'Internal Server Error' },
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.API_ERROR);
    });

    it('should categorize axios no response as NETWORK_ERROR', () => {
      const axiosError = {
        isAxiosError: true,
        request: {},
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.NETWORK_ERROR);
    });

    it('should categorize axios request setup error as API_UNAVAILABLE', () => {
      const axiosError = {
        isAxiosError: true,
      };

      const error = categorizeError(axiosError);

      expect(error.type).toBe(ObsidianErrorType.API_UNAVAILABLE);
    });

    it('should preserve ObsidianError', () => {
      const obsidianError = createError(
        ObsidianErrorType.FILE_TOO_LARGE,
        'File is too large'
      );

      const error = categorizeError(obsidianError);

      expect(error).toBe(obsidianError);
    });

    it('should categorize unknown error as UNKNOWN', () => {
      const error = categorizeError('random string error');

      expect(error.type).toBe(ObsidianErrorType.UNKNOWN);
      expect(error.message).toBe('random string error');
    });

    it('should categorize generic Error as UNKNOWN', () => {
      const error = categorizeError(new Error('Generic error'));

      expect(error.type).toBe(ObsidianErrorType.UNKNOWN);
      expect(error.message).toBe('Generic error');
    });
  });

  describe('isRetryableError', () => {
    it('should mark IO_ERROR as retryable', () => {
      const error = createError(ObsidianErrorType.IO_ERROR, 'I/O error');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark NETWORK_ERROR as retryable', () => {
      const error = createError(ObsidianErrorType.NETWORK_ERROR, 'Network error');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark API_UNAVAILABLE as retryable', () => {
      const error = createError(ObsidianErrorType.API_UNAVAILABLE, 'API unavailable');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should mark DISK_FULL as retryable', () => {
      const error = createError(ObsidianErrorType.DISK_FULL, 'Disk full');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should not mark FILE_NOT_FOUND as retryable', () => {
      const error = createError(ObsidianErrorType.FILE_NOT_FOUND, 'Not found');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not mark PERMISSION_DENIED as retryable', () => {
      const error = createError(ObsidianErrorType.PERMISSION_DENIED, 'Permission denied');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not mark INVALID_PATH as retryable', () => {
      const error = createError(ObsidianErrorType.INVALID_PATH, 'Invalid path');
      expect(isRetryableError(error)).toBe(false);
    });

    it('should not mark AUTHENTICATION_ERROR as retryable', () => {
      const error = createError(ObsidianErrorType.AUTHENTICATION_ERROR, 'Auth error');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('formatError', () => {
    it('should format basic error', () => {
      const error = createError(ObsidianErrorType.FILE_NOT_FOUND, 'File not found');
      const formatted = formatError(error);

      expect(formatted).toBe('[FILE_NOT_FOUND] File not found');
    });

    it('should include suggested action in formatted error', () => {
      const error = createError(ObsidianErrorType.FILE_NOT_FOUND, 'File not found', {
        suggestedAction: 'Check the path',
      });
      const formatted = formatError(error);

      expect(formatted).toContain('[FILE_NOT_FOUND] File not found');
      expect(formatted).toContain('Suggested action: Check the path');
    });

    it('should not include suggested action if not present', () => {
      const error = createError(ObsidianErrorType.UNKNOWN, 'Unknown error');
      const formatted = formatError(error);

      expect(formatted).toBe('[UNKNOWN] Unknown error');
      expect(formatted).not.toContain('Suggested action');
    });
  });
});
