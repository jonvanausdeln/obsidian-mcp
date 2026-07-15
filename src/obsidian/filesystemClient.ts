import { promises as fs } from 'fs';
import { join, normalize, resolve, relative, sep } from 'path';
import type { Logger } from 'winston';
import type { Config } from '../utils/config.js';
import type { RetryManager } from '../utils/retry.js';
import { categorizeError, createError } from './errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import { parseDateISO, getDailyNotePath as getDefaultDailyNotePath } from '../utils/dateUtils.js';
import type {
  ReadNoteResult,
  WriteNoteResult,
  AppendNoteResult,
  DeleteNoteResult,
  FileInfo,
  FileStats,
} from '../types/obsidian.js';

/**
 * FileSystemClient - Direct file operations for Obsidian vault
 * Provides filesystem-based access to notes with retry logic and error handling
 */
export class FileSystemClient {
  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
    private readonly retryManager: RetryManager
  ) {
    this.logger.info('FileSystemClient initialized', {
      vaultPath: this.config.vaultPath,
      maxFileSizeMB: this.config.maxFileSizeMB,
      enableDelete: this.config.enableDelete,
    });
  }

  /**
   * Read a file from the vault
   */
  async readFile(path: string): Promise<ReadNoteResult> {
    this.logger.debug('Reading file', { path });

    const absolutePath = this.resolveVaultPath(path);
    this.validatePath(path, absolutePath);

    try {
      // Check file size before reading
      await this.checkFileSize(absolutePath);

      // Read file with retry logic
      const content = await this.retryManager.execute(() => fs.readFile(absolutePath, 'utf-8'));

      // Get file stats
      const stats = await this.getFileStats(absolutePath);

      this.logger.info('File read successfully', { path, size: stats.size });

      return {
        content,
        stats,
      };
    } catch (error) {
      this.logger.error('Failed to read file', { path, error });
      throw categorizeError(error, { path });
    }
  }

  /**
   * Write content to a file (create or overwrite)
   */
  async writeFile(path: string, content: string, createDirs = true): Promise<WriteNoteResult> {
    this.logger.debug('Writing file', { path, createDirs, contentLength: content.length });

    const absolutePath = this.resolveVaultPath(path);
    this.validatePath(path, absolutePath);

    try {
      // Check if file exists
      const existed = await this.fileExists(absolutePath);

      // Create directories if needed
      if (createDirs) {
        const dir = join(absolutePath, '..');
        await this.retryManager.execute(() => fs.mkdir(dir, { recursive: true }));
      }

      // Write file with retry logic
      await this.retryManager.execute(() => fs.writeFile(absolutePath, content, 'utf-8'));

      this.logger.info('File written successfully', {
        path,
        created: !existed,
        size: content.length,
      });

      return {
        success: true,
        path,
        created: !existed,
      };
    } catch (error) {
      this.logger.error('Failed to write file', { path, error });
      throw categorizeError(error, { path });
    }
  }

  /**
   * Append content to the end of a file
   */
  async appendFile(path: string, content: string, separator = '\n'): Promise<AppendNoteResult> {
    this.logger.debug('Appending to file', { path, contentLength: content.length });

    const absolutePath = this.resolveVaultPath(path);
    this.validatePath(path, absolutePath);

    try {
      // Read existing content
      const existing = await this.retryManager.execute(() => fs.readFile(absolutePath, 'utf-8'));

      // Append with separator
      const newContent = existing + separator + content;

      // Write back
      await this.retryManager.execute(() => fs.writeFile(absolutePath, newContent, 'utf-8'));

      this.logger.info('Content appended successfully', {
        path,
        newLength: newContent.length,
      });

      return {
        success: true,
        newLength: newContent.length,
      };
    } catch (error) {
      this.logger.error('Failed to append to file', { path, error });
      throw categorizeError(error, { path });
    }
  }

  /**
   * Delete a file from the vault
   */
  async deleteFile(path: string): Promise<DeleteNoteResult> {
    this.logger.debug('Deleting file', { path });

    // Check if delete is enabled
    if (!this.config.enableDelete) {
      throw createError(
        ObsidianErrorType.PERMISSION_DENIED,
        'Delete operations are disabled',
        {
          path,
          suggestedAction: 'Set ENABLE_DELETE=true in configuration to enable delete operations.',
        }
      );
    }

    const absolutePath = this.resolveVaultPath(path);
    this.validatePath(path, absolutePath);

    try {
      // Verify file exists before deleting
      await fs.access(absolutePath);

      // Delete with retry logic
      await this.retryManager.execute(() => fs.unlink(absolutePath));

      this.logger.warn('File deleted', { path });

      return {
        success: true,
        deleted: path,
      };
    } catch (error) {
      this.logger.error('Failed to delete file', { path, error });
      throw categorizeError(error, { path });
    }
  }

  /**
   * List files in a directory
   */
  async listFiles(dirPath = '', recursive = false): Promise<FileInfo[]> {
    this.logger.debug('Listing files', { dirPath, recursive });

    const absolutePath = dirPath ? this.resolveVaultPath(dirPath) : this.config.vaultPath;

    try {
      const files: FileInfo[] = [];

      await this.collectFiles(absolutePath, files, recursive, dirPath);

      // Filter to only .md files and sort by name
      const mdFiles = files
        .filter((f) => !f.isDirectory && f.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name));

      this.logger.info('Files listed successfully', {
        dirPath,
        count: mdFiles.length,
      });

      return mdFiles;
    } catch (error) {
      this.logger.error('Failed to list files', { dirPath, error });
      throw categorizeError(error, { path: dirPath });
    }
  }

  /**
   * Get daily note path for a given ISO date string (YYYY-MM-DD)
   * Pattern: <folder>/YYYY-MM-DD.md
   *
   * The folder is auto-detected from the configured candidate folders
   * (default: "Daily Notes" then "Daily"). Selection order:
   *   1. A candidate where the note file already exists
   *   2. A candidate whose folder directory already exists
   *   3. The first configured candidate (used when creating a new note)
   */
  async getDailyNotePath(dateStr: string): Promise<string> {
    this.logger.debug('Getting daily note path', { date: dateStr });

    const date = parseDateISO(dateStr);
    const candidates = this.config.dailyNotesFolders;

    // 1. Prefer a candidate whose note file already exists
    for (const folder of candidates) {
      const candidatePath = getDefaultDailyNotePath(date, folder);
      if (await this.fileExists(this.resolveVaultPath(candidatePath))) {
        this.logger.debug('Daily note path resolved (existing file)', {
          date: dateStr,
          path: candidatePath,
        });
        return candidatePath;
      }
    }

    // 2. Otherwise prefer a candidate whose folder directory already exists
    for (const folder of candidates) {
      if (await this.directoryExists(this.resolveVaultPath(folder))) {
        const candidatePath = getDefaultDailyNotePath(date, folder);
        this.logger.debug('Daily note path resolved (existing folder)', {
          date: dateStr,
          path: candidatePath,
        });
        return candidatePath;
      }
    }

    // 3. Fall back to the first configured candidate (for a brand-new note)
    const path = getDefaultDailyNotePath(date, candidates[0]);
    this.logger.debug('Daily note path resolved (default)', { date: dateStr, path });

    return path;
  }

  /**
   * Get file statistics
   */
  private async getFileStats(absolutePath: string): Promise<FileStats> {
    const stats = await fs.stat(absolutePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    };
  }

  /**
   * Check if file exists
   */
  private async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists
   */
  private async directoryExists(absolutePath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(absolutePath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Recursively collect files from a directory
   */
  private async collectFiles(
    absolutePath: string,
    files: FileInfo[],
    recursive: boolean,
    basePath: string
  ): Promise<void> {
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip .obsidian and other hidden directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = join(absolutePath, entry.name);
      const stats = await fs.stat(fullPath);

      // Get relative path from vault root
      const relativePath = relative(this.config.vaultPath, fullPath);
      const normalizedPath = relativePath.split(sep).join('/');

      if (entry.isDirectory()) {
        if (recursive) {
          await this.collectFiles(fullPath, files, recursive, basePath);
        }
      } else {
        files.push({
          path: normalizedPath,
          name: entry.name,
          size: stats.size,
          modified: stats.mtime,
          isDirectory: false,
        });
      }
    }
  }

  /**
   * Validate path to prevent directory traversal attacks
   */
  private validatePath(relativePath: string, absolutePath: string): void {
    // Check for parent directory references
    if (relativePath.includes('..')) {
      throw createError(
        ObsidianErrorType.INVALID_PATH,
        'Path contains invalid parent directory reference (..)',
        {
          path: relativePath,
          suggestedAction: 'Use relative paths without ".." references.',
        }
      );
    }

    // Ensure the resolved path is within the vault
    const normalizedVault = normalize(this.config.vaultPath);
    const normalizedPath = normalize(absolutePath);

    if (normalizedPath !== normalizedVault && !normalizedPath.startsWith(normalizedVault + sep)) {
      throw createError(
        ObsidianErrorType.INVALID_PATH,
        'Path is outside vault boundary',
        {
          path: relativePath,
          suggestedAction: 'Ensure the path is relative to the vault root.',
        }
      );
    }
  }

  /**
   * Resolve relative path to absolute vault path
   */
  private resolveVaultPath(relativePath: string): string {
    // Normalize the relative path (convert backslashes to forward slashes on Windows)
    const normalized = relativePath.split('\\').join('/');
    return resolve(this.config.vaultPath, normalized);
  }

  /**
   * Check if file size is within limits
   */
  private async checkFileSize(absolutePath: string): Promise<void> {
    const stats = await fs.stat(absolutePath);
    const maxBytes = this.config.maxFileSizeMB * 1024 * 1024;

    if (stats.size > maxBytes) {
      throw createError(
        ObsidianErrorType.FILE_TOO_LARGE,
        `File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds limit (${this.config.maxFileSizeMB}MB)`,
        {
          suggestedAction: `Increase MAX_FILE_SIZE_MB or use a different file. Current limit: ${this.config.maxFileSizeMB}MB`,
        }
      );
    }
  }
}
