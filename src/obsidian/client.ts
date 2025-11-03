import type { Logger } from 'winston';
import type { Config } from '../utils/config.js';
import type { RetryManager } from '../utils/retry.js';
import { FileSystemClient } from './filesystemClient.js';
import { RestApiClient } from './restApiClient.js';
import type {
  ReadNoteResult,
  WriteNoteResult,
  AppendNoteResult,
  DeleteNoteResult,
  GetDailyNoteResult,
  AppendToDailyResult,
  ActiveFileInfo,
  FileInfo,
} from '../types/obsidian.js';

/**
 * ObsidianClient - Hybrid coordinator for filesystem and API access
 * Provides unified interface with automatic fallback from API to filesystem
 */
export class ObsidianClient {
  private filesystemClient: FileSystemClient;
  private apiClient: RestApiClient;
  private apiAvailable = false;
  private apiChecked = false;

  constructor(
    private readonly _config: Config,
    private readonly logger: Logger,
    _retryManager: RetryManager
  ) {
    // Initialize both clients
    this.filesystemClient = new FileSystemClient(_config, logger, _retryManager);
    this.apiClient = new RestApiClient(_config, logger, _retryManager);

    this.logger.info('ObsidianClient initialized in hybrid mode', {
      hasApiConfig: this.apiClient.isConfigured(),
    });
  }

  /**
   * Get configuration (for tools that need vault path access)
   */
  get config(): Config {
    return this._config;
  }

  /**
   * Check API availability (called once, then cached)
   */
  async initialize(): Promise<void> {
    if (this.apiChecked) {
      return;
    }

    if (this.apiClient.isConfigured()) {
      this.apiAvailable = await this.apiClient.checkAvailability();
      this.logger.info('API availability checked', { available: this.apiAvailable });
    } else {
      this.logger.info('API not configured, using filesystem-only mode');
    }

    this.apiChecked = true;
  }

  /**
   * Get operation mode
   */
  getMode(): 'filesystem' | 'api' | 'hybrid' {
    if (!this.apiClient.isConfigured()) {
      return 'filesystem';
    }
    return this.apiAvailable ? 'hybrid' : 'filesystem';
  }

  /**
   * Get filesystem client (for direct filesystem operations)
   */
  getFilesystemClient(): FileSystemClient {
    return this.filesystemClient;
  }

  /**
   * Get API client (for direct API operations)
   */
  getApiClient(): RestApiClient {
    return this.apiClient;
  }

  /**
   * Read a file (filesystem-only, most reliable)
   */
  async readFile(path: string): Promise<ReadNoteResult> {
    return this.filesystemClient.readFile(path);
  }

  /**
   * Write a file (filesystem-only, most reliable)
   */
  async writeFile(path: string, content: string, createDirs = true): Promise<WriteNoteResult> {
    return this.filesystemClient.writeFile(path, content, createDirs);
  }

  /**
   * Append to a file (filesystem-only, most reliable)
   */
  async appendFile(path: string, content: string, separator = '\n'): Promise<AppendNoteResult> {
    return this.filesystemClient.appendFile(path, content, separator);
  }

  /**
   * Delete a file (filesystem-only)
   */
  async deleteFile(path: string): Promise<DeleteNoteResult> {
    return this.filesystemClient.deleteFile(path);
  }

  /**
   * List files (filesystem-only)
   */
  async listFiles(directory: string, recursive = false): Promise<FileInfo[]> {
    return this.filesystemClient.listFiles(directory, recursive);
  }

  /**
   * Get daily note (API-first with filesystem fallback)
   * This is where the hybrid approach shines!
   */
  async getDailyNote(date: string): Promise<GetDailyNoteResult> {
    await this.initialize();

    // Try API first if available
    if (this.apiAvailable) {
      try {
        this.logger.debug('Attempting to get daily note via API', { date });
        const apiResult = await this.apiClient.getDailyNote(date);

        // If file exists, read it to get content
        if (apiResult.exists) {
          try {
            const fileResult = await this.filesystemClient.readFile(apiResult.path);
            return {
              path: apiResult.path,
              exists: true,
              content: fileResult.content,
              stats: fileResult.stats,
              source: 'api',
            };
          } catch (error) {
            this.logger.warn('Failed to read daily note content after API lookup', {
              path: apiResult.path,
              error,
            });
          }
        }

        return {
          path: apiResult.path,
          exists: false,
          source: 'api',
        };
      } catch (error) {
        this.logger.warn('API getDailyNote failed, falling back to filesystem', { error });
        // Fall through to filesystem
      }
    }

    // Filesystem fallback
    this.logger.debug('Using filesystem to get daily note', { date });
    const path = this.filesystemClient.getDailyNotePath(date);

    try {
      const result = await this.filesystemClient.readFile(path);
      return {
        path,
        exists: true,
        content: result.content,
        stats: result.stats,
        source: 'filesystem',
      };
    } catch {
      return {
        path,
        exists: false,
        source: 'filesystem',
      };
    }
  }

  /**
   * Append to daily note (API-first with filesystem fallback)
   */
  async appendToDaily(
    content: string,
    date: string,
    separator = '\n',
    timestamp = false,
    createIfMissing = true
  ): Promise<AppendToDailyResult> {
    await this.initialize();

    // Get daily note path
    const dailyNoteInfo = await this.getDailyNote(date);
    const path = dailyNoteInfo.path;

    // Add timestamp if requested
    let finalContent = content;
    if (timestamp) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      finalContent = `${timeStr} - ${content}`;
    }

    // Try API append first if available
    if (this.apiAvailable && dailyNoteInfo.exists) {
      try {
        this.logger.debug('Attempting to append to daily note via API', { path, date });
        await this.apiClient.appendFile(path, separator + finalContent);

        // Get new length from filesystem
        const result = await this.filesystemClient.readFile(path);

        return {
          success: true,
          path,
          newLength: result.content.length,
          source: 'api',
        };
      } catch (error) {
        this.logger.warn('API append failed, falling back to filesystem', { error });
        // Fall through to filesystem
      }
    }

    // Filesystem fallback
    this.logger.debug('Using filesystem to append to daily note', { path, date });

    // Create file if missing and requested
    if (!dailyNoteInfo.exists && createIfMissing) {
      const dateObj = new Date(date);
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      const initialContent = `# ${formattedDate}\n\n${finalContent}`;
      await this.filesystemClient.writeFile(path, initialContent, true);

      return {
        success: true,
        path,
        newLength: initialContent.length,
        source: 'filesystem',
      };
    }

    const appendResult = await this.filesystemClient.appendFile(path, finalContent, separator);

    return {
      success: appendResult.success,
      path,
      newLength: appendResult.newLength,
      source: 'filesystem',
    };
  }

  /**
   * Get active file (API-only feature)
   */
  async getActiveFile(): Promise<ActiveFileInfo | null> {
    await this.initialize();

    if (!this.apiAvailable) {
      this.logger.debug('API not available, cannot get active file');
      return null;
    }

    try {
      return await this.apiClient.getActiveFile();
    } catch (error) {
      this.logger.warn('Failed to get active file', { error });
      return null;
    }
  }
}
