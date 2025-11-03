import axios, { AxiosInstance, AxiosError } from 'axios';
import type { Logger } from 'winston';
import type { Config } from '../utils/config.js';
import type { RetryManager } from '../utils/retry.js';
import { categorizeError, createError } from './errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import type {
  PeriodicNoteInfo,
  ActiveFileInfo,
  CommandResult,
  ReadNoteResult,
  WriteNoteResult,
  FileStats,
  ObsidianError,
} from '../types/obsidian.js';

/**
 * RestApiClient - Wrapper for Obsidian Local REST API
 * Provides API-based access to Obsidian vault with enhanced features
 */
export class RestApiClient {
  private client: AxiosInstance | null = null;
  private availabilityChecked = false;
  private isAvailable = false;

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly retryManager: RetryManager
  ) {
    this.initializeClient();
  }

  /**
   * Initialize axios client if API is configured
   */
  private initializeClient(): void {
    if (!this.config.apiUrl || !this.config.apiKey) {
      this.logger.debug('API not configured, running in filesystem-only mode');
      return;
    }

    try {
      this.client = axios.create({
        baseURL: this.config.apiUrl,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
        httpsAgent: this.config.verifySsl
          ? undefined
          : {
              rejectUnauthorized: false,
            },
      });

      this.logger.info('REST API client initialized', {
        apiUrl: this.config.apiUrl,
        verifySsl: this.config.verifySsl,
      });
    } catch (error) {
      this.logger.error('Failed to initialize REST API client', { error });
      this.client = null;
    }
  }

  /**
   * Check if API is available and responding
   */
  async checkAvailability(): Promise<boolean> {
    if (!this.client) {
      this.isAvailable = false;
      this.availabilityChecked = true;
      return false;
    }

    if (this.availabilityChecked) {
      return this.isAvailable;
    }

    try {
      // Try to ping the API (use vault endpoint as health check)
      await this.client.get('/');
      this.isAvailable = true;
      this.logger.info('REST API is available');
    } catch (error) {
      this.isAvailable = false;
      this.logger.warn('REST API is not available', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    this.availabilityChecked = true;
    return this.isAvailable;
  }

  /**
   * Get whether API is configured
   */
  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Get whether API is available (cached after first check)
   */
  getAvailability(): boolean {
    return this.isAvailable;
  }

  /**
   * Reset availability cache (useful for testing or reconnection)
   */
  resetAvailability(): void {
    this.availabilityChecked = false;
    this.isAvailable = false;
  }

  /**
   * Get daily note path and info for a given date
   */
  async getDailyNote(date: string): Promise<PeriodicNoteInfo> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured', {
        suggestedAction: 'Configure OBSIDIAN_API_URL and OBSIDIAN_API_KEY',
      });
    }

    try {
      this.logger.debug('Getting daily note from API', { date });

      const response = await this.retryManager.execute(() =>
        this.client!.get<PeriodicNoteInfo>(`/periodic/daily/${date}`)
      );

      this.logger.info('Daily note info retrieved', {
        date,
        path: response.data.path,
        exists: response.data.exists,
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get daily note from API', { date, error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Read a file via API
   */
  async readFile(path: string): Promise<ReadNoteResult> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured');
    }

    try {
      this.logger.debug('Reading file via API', { path });

      const response = await this.retryManager.execute(() =>
        this.client!.get<string>(`/vault/${encodeURIComponent(path)}`, {
          headers: { Accept: 'text/markdown' },
        })
      );

      // Get file stats via separate call
      const statsResponse = await this.client.head(`/vault/${encodeURIComponent(path)}`);
      const stats = this.parseFileStats(statsResponse.headers);

      this.logger.info('File read via API', { path, size: stats.size });

      return {
        content: response.data,
        stats,
      };
    } catch (error) {
      this.logger.error('Failed to read file via API', { path, error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Write a file via API
   */
  async writeFile(path: string, content: string): Promise<WriteNoteResult> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured');
    }

    try {
      this.logger.debug('Writing file via API', { path, contentLength: content.length });

      // Check if file exists first
      let existed = false;
      try {
        await this.client.head(`/vault/${encodeURIComponent(path)}`);
        existed = true;
      } catch {
        // File doesn't exist, that's okay
      }

      // Write the file
      await this.retryManager.execute(() =>
        this.client!.put(`/vault/${encodeURIComponent(path)}`, content, {
          headers: { 'Content-Type': 'text/markdown' },
        })
      );

      this.logger.info('File written via API', { path, created: !existed });

      return {
        success: true,
        path,
        created: !existed,
      };
    } catch (error) {
      this.logger.error('Failed to write file via API', { path, error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Append content to a file via API
   */
  async appendFile(path: string, content: string): Promise<void> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured');
    }

    try {
      this.logger.debug('Appending to file via API', { path, contentLength: content.length });

      await this.retryManager.execute(() =>
        this.client!.post(`/vault/${encodeURIComponent(path)}`, content, {
          headers: { 'Content-Type': 'text/markdown' },
        })
      );

      this.logger.info('Content appended via API', { path });
    } catch (error) {
      this.logger.error('Failed to append to file via API', { path, error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Get active file info
   */
  async getActiveFile(): Promise<ActiveFileInfo> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured');
    }

    try {
      this.logger.debug('Getting active file from API');

      const response = await this.retryManager.execute(() =>
        this.client!.get<ActiveFileInfo>('/active/')
      );

      this.logger.info('Active file retrieved', { path: response.data.path });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get active file from API', { error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Execute a command in Obsidian
   */
  async executeCommand(commandId: string, filePath?: string): Promise<CommandResult> {
    if (!this.client) {
      throw createError(ObsidianErrorType.API_UNAVAILABLE, 'API client not configured');
    }

    try {
      this.logger.debug('Executing command via API', { commandId, filePath });

      const endpoint = filePath
        ? `/vault/${encodeURIComponent(filePath)}/commands/${commandId}`
        : `/commands/${commandId}`;

      const response = await this.retryManager.execute(() =>
        this.client!.post<CommandResult>(endpoint)
      );

      this.logger.info('Command executed via API', { commandId, success: response.data.success });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to execute command via API', { commandId, error });
      throw this.categorizeApiError(error);
    }
  }

  /**
   * Parse file stats from response headers
   */
  private parseFileStats(headers: unknown): FileStats {
    const headersObj = headers as Record<string, unknown>;
    const contentLength = headersObj['content-length'];
    const lastModified = headersObj['last-modified'];

    return {
      size: contentLength ? parseInt(String(contentLength), 10) : 0,
      created: new Date(), // API doesn't provide creation time
      modified: lastModified ? new Date(String(lastModified)) : new Date(),
    };
  }

  /**
   * Categorize API errors into Obsidian error types
   */
  private categorizeApiError(error: unknown): ObsidianError {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;

      // Network errors
      if (!axiosError.response) {
        return createError(
          ObsidianErrorType.NETWORK_ERROR,
          'Failed to connect to Obsidian API',
          {
            suggestedAction: 'Ensure Obsidian is running and the REST API plugin is enabled',
            originalError: error,
          }
        );
      }

      // HTTP status errors
      const status = axiosError.response.status;
      switch (status) {
        case 401:
        case 403:
          return createError(
            ObsidianErrorType.AUTHENTICATION_ERROR,
            'API authentication failed',
            {
              suggestedAction: 'Check your OBSIDIAN_API_KEY is correct',
              originalError: error,
            }
          );
        case 404:
          return createError(ObsidianErrorType.FILE_NOT_FOUND, 'File not found', {
            originalError: error,
          });
        case 500:
        case 502:
        case 503:
          return createError(ObsidianErrorType.API_ERROR, 'Obsidian API error', {
            suggestedAction: 'Check Obsidian application logs',
            originalError: error,
          });
        default:
          return createError(
            ObsidianErrorType.API_ERROR,
            `API request failed with status ${status}`,
            {
              originalError: error,
            }
          );
      }
    }

    return categorizeError(error);
  }
}
