import { ObsidianErrorType, type ObsidianError } from '../types/obsidian.js';

/**
 * Create a structured ObsidianError
 */
export function createError(
  type: ObsidianErrorType,
  message: string,
  details?: ObsidianError['details']
): ObsidianError {
  const error: ObsidianError = {
    type,
    message,
  };

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

/**
 * Categorize and convert a raw error into an ObsidianError
 */
export function categorizeError(error: unknown, context?: { path?: string }): ObsidianError {
  // Handle Node.js filesystem errors
  if (isNodeError(error)) {
    return categorizeNodeError(error, context);
  }

  // Handle network/HTTP errors
  if (isAxiosError(error)) {
    return categorizeNetworkError(error);
  }

  // Handle known ObsidianError
  if (isObsidianError(error)) {
    return error;
  }

  // Unknown error
  return createError(
    ObsidianErrorType.UNKNOWN,
    error instanceof Error ? error.message : String(error),
    {
      originalError: error,
      ...context,
    }
  );
}

/**
 * Categorize Node.js filesystem errors
 */
function categorizeNodeError(error: NodeJS.ErrnoException, context?: { path?: string }): ObsidianError {
  const path = context?.path;

  switch (error.code) {
    case 'ENOENT':
      return createError(
        ObsidianErrorType.FILE_NOT_FOUND,
        `File not found: ${path || 'unknown'}`,
        path
          ? {
              path,
              suggestedAction: `Check the file path. Use list_notes to see available notes in '${path.split('/').slice(0, -1).join('/')}' folder.`,
              originalError: error,
            }
          : {
              suggestedAction: 'Verify the file path is correct.',
              originalError: error,
            }
      );

    case 'EACCES':
    case 'EPERM':
      return createError(
        ObsidianErrorType.PERMISSION_DENIED,
        `Permission denied: ${path || 'unknown'}`,
        path
          ? {
              path,
              suggestedAction: 'Check file permissions and ensure you have read/write access to the vault.',
              originalError: error,
            }
          : {
              suggestedAction: 'Check file permissions and ensure you have read/write access to the vault.',
              originalError: error,
            }
      );

    case 'ENOSPC':
      return createError(
        ObsidianErrorType.DISK_FULL,
        'No space left on device',
        path
          ? {
              path,
              suggestedAction: 'Free up disk space and try again.',
              originalError: error,
            }
          : {
              suggestedAction: 'Free up disk space and try again.',
              originalError: error,
            }
      );

    case 'EISDIR':
      return createError(
        ObsidianErrorType.INVALID_PATH,
        `Expected file but found directory: ${path || 'unknown'}`,
        path
          ? {
              path,
              suggestedAction: 'Specify a file path, not a directory.',
              originalError: error,
            }
          : {
              suggestedAction: 'Specify a file path, not a directory.',
              originalError: error,
            }
      );

    case 'ENOTDIR':
      return createError(
        ObsidianErrorType.INVALID_PATH,
        `Expected directory but found file: ${path || 'unknown'}`,
        path
          ? {
              path,
              suggestedAction: 'Specify a directory path, not a file.',
              originalError: error,
            }
          : {
              suggestedAction: 'Specify a directory path, not a file.',
              originalError: error,
            }
      );

    default:
      return createError(
        ObsidianErrorType.IO_ERROR,
        error.message || 'File system error',
        path
          ? {
              path,
              suggestedAction: 'Check the error message for details and try again.',
              originalError: error,
            }
          : {
              suggestedAction: 'Check the error message for details and try again.',
              originalError: error,
            }
      );
  }
}

/**
 * Categorize network/HTTP errors (axios)
 */
function categorizeNetworkError(error: any): ObsidianError {
  if (error.response) {
    // Server responded with error status
    const status = error.response.status;

    if (status === 401 || status === 403) {
      return createError(
        ObsidianErrorType.AUTHENTICATION_ERROR,
        'Authentication failed',
        {
          suggestedAction: 'Check your OBSIDIAN_API_KEY is correct.',
          originalError: error,
        }
      );
    }

    if (status === 404) {
      return createError(
        ObsidianErrorType.FILE_NOT_FOUND,
        'Resource not found',
        {
          suggestedAction: 'Verify the file path or endpoint is correct.',
          originalError: error,
        }
      );
    }

    return createError(
      ObsidianErrorType.API_ERROR,
      `API error: ${error.response.statusText || status}`,
      {
        suggestedAction: 'Check the API response for details.',
        originalError: error,
      }
    );
  } else if (error.request) {
    // Request made but no response
    return createError(
      ObsidianErrorType.NETWORK_ERROR,
      'Network error: No response from server',
      {
        suggestedAction: 'Check if Obsidian is running and the API is accessible.',
        originalError: error,
      }
    );
  } else {
    return createError(
      ObsidianErrorType.API_UNAVAILABLE,
      'Failed to make API request',
      {
        suggestedAction: 'Check your network connection and API configuration.',
        originalError: error,
      }
    );
  }
}

/**
 * Determine if an error should be retried
 */
export function isRetryableError(error: ObsidianError): boolean {
  const retryableTypes = [
    ObsidianErrorType.IO_ERROR,
    ObsidianErrorType.NETWORK_ERROR,
    ObsidianErrorType.API_UNAVAILABLE,
    ObsidianErrorType.DISK_FULL,
  ];

  return retryableTypes.includes(error.type);
}

/**
 * Type guards
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function isAxiosError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'isAxiosError' in error &&
    error.isAxiosError === true
  );
}

function isObsidianError(error: unknown): error is ObsidianError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'message' in error &&
    Object.values(ObsidianErrorType).includes((error as ObsidianError).type)
  );
}

/**
 * Format error for display
 */
export function formatError(error: ObsidianError): string {
  let formatted = `[${error.type}] ${error.message}`;

  if (error.details?.suggestedAction) {
    formatted += `\nSuggested action: ${error.details.suggestedAction}`;
  }

  return formatted;
}
