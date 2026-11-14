import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { getConfig } from '../../src/utils/config.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('FileSystemClient', () => {
  let client: FileSystemClient;
  let config: Config;
  let logger: Logger;
  let retryManager: RetryManager;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create a temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-' + Date.now());
    await fs.mkdir(testVaultPath, { recursive: true });
    await fs.mkdir(join(testVaultPath, '.obsidian'), { recursive: true });

    // Mock config with test vault path
    config = {
      vaultPath: testVaultPath,
      logLevel: 'error' as const,
      maxFileSizeMB: 1,
      enableDelete: true,
      retryMaxAttempts: 3,
      retryBaseDelay: 10,
      verifySsl: false,
      dailyNotesFolders: ['Daily Notes', 'Daily'],
    };

    logger = initializeLogger(config);
    retryManager = new RetryManager(
      {
        maxAttempts: config.retryMaxAttempts,
        baseDelay: config.retryBaseDelay,
      },
      logger
    );

    client = new FileSystemClient(config, logger, retryManager);
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('readFile', () => {
    it('should read a file successfully', async () => {
      // Arrange
      const testContent = '# Test Note\n\nThis is a test.';
      const testPath = 'test-note.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await client.readFile(testPath);

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.stats.size).toBe(testContent.length);
      expect(result.stats.modified).toBeInstanceOf(Date);
      expect(result.stats.created).toBeInstanceOf(Date);
    });

    it('should read a file in a subdirectory', async () => {
      // Arrange
      const testContent = '# Nested Note';
      const testPath = 'subfolder/nested.md';
      await fs.mkdir(join(testVaultPath, 'subfolder'), { recursive: true });
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await client.readFile(testPath);

      // Assert
      expect(result.content).toBe(testContent);
    });

    it('should throw FILE_NOT_FOUND for non-existent file', async () => {
      // Act & Assert
      await expect(client.readFile('non-existent.md')).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
        message: expect.stringContaining('File not found'),
      });
    });

    it('should throw INVALID_PATH for path with parent directory reference', async () => {
      // Act & Assert
      await expect(client.readFile('../outside.md')).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
        message: expect.stringContaining('parent directory reference'),
      });
    });

    it('should throw FILE_TOO_LARGE for files exceeding size limit', async () => {
      // Arrange - create a file larger than 1MB limit
      const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB
      const testPath = 'large-file.md';
      await fs.writeFile(join(testVaultPath, testPath), largeContent);

      // Act & Assert
      await expect(client.readFile(testPath)).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_TOO_LARGE,
        message: expect.stringContaining('exceeds limit'),
      });
    });

    it('should handle Windows-style paths', async () => {
      // Arrange
      const testContent = '# Test';
      const testPath = 'folder\\note.md';
      await fs.mkdir(join(testVaultPath, 'folder'), { recursive: true });
      await fs.writeFile(join(testVaultPath, 'folder', 'note.md'), testContent);

      // Act
      const result = await client.readFile(testPath);

      // Assert
      expect(result.content).toBe(testContent);
    });
  });

  describe('writeFile', () => {
    it('should create a new file', async () => {
      // Arrange
      const testContent = '# New Note';
      const testPath = 'new-note.md';

      // Act
      const result = await client.writeFile(testPath, testContent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.path).toBe(testPath);

      // Verify file was created
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should overwrite an existing file', async () => {
      // Arrange
      const testPath = 'existing.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Old content');

      // Act
      const newContent = '# Updated';
      const result = await client.writeFile(testPath, newContent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(false);

      // Verify content was updated
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(newContent);
    });

    it('should create directories when createDirs is true', async () => {
      // Arrange
      const testContent = '# Deep Note';
      const testPath = 'deep/nested/path/note.md';

      // Act
      const result = await client.writeFile(testPath, testContent, true);

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);

      // Verify file and directories exist
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should fail when directory does not exist and createDirs is false', async () => {
      // Arrange
      const testContent = '# Note';
      const testPath = 'nonexistent/note.md';

      // Act & Assert
      await expect(client.writeFile(testPath, testContent, false)).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
      });
    });

    it('should throw INVALID_PATH for path traversal attempt', async () => {
      // Act & Assert
      await expect(client.writeFile('../escape.md', 'content')).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
      });
    });
  });

  describe('appendFile', () => {
    it('should append content to existing file', async () => {
      // Arrange
      const testPath = 'append-test.md';
      const initialContent = '# Note\n\nFirst paragraph.';
      await fs.writeFile(join(testVaultPath, testPath), initialContent);

      // Act
      const appendContent = 'Second paragraph.';
      const result = await client.appendFile(testPath, appendContent);

      // Assert
      expect(result.success).toBe(true);
      expect(result.newLength).toBeGreaterThan(initialContent.length);

      // Verify content
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(initialContent + '\n' + appendContent);
    });

    it('should use custom separator', async () => {
      // Arrange
      const testPath = 'append-separator.md';
      const initialContent = 'Line 1';
      await fs.writeFile(join(testVaultPath, testPath), initialContent);

      // Act
      const result = await client.appendFile(testPath, 'Line 2', '\n---\n');

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('Line 1\n---\nLine 2');
    });

    it('should throw FILE_NOT_FOUND for non-existent file', async () => {
      // Act & Assert
      await expect(client.appendFile('missing.md', 'content')).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
      });
    });
  });

  describe('deleteFile', () => {
    it('should delete an existing file', async () => {
      // Arrange
      const testPath = 'to-delete.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Content');

      // Act
      const result = await client.deleteFile(testPath);

      // Assert
      expect(result.success).toBe(true);
      expect(result.deleted).toBe(testPath);

      // Verify file was deleted
      await expect(fs.access(join(testVaultPath, testPath))).rejects.toThrow();
    });

    it('should throw error when delete is disabled', async () => {
      // Arrange
      const disabledConfig = { ...config, enableDelete: false };
      const disabledClient = new FileSystemClient(disabledConfig, logger, retryManager);
      const testPath = 'cannot-delete.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Content');

      // Act & Assert
      await expect(disabledClient.deleteFile(testPath)).rejects.toMatchObject({
        type: ObsidianErrorType.PERMISSION_DENIED,
        message: expect.stringContaining('disabled'),
      });
    });

    it('should throw FILE_NOT_FOUND for non-existent file', async () => {
      // Act & Assert
      await expect(client.deleteFile('missing.md')).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
      });
    });
  });

  describe('listFiles', () => {
    it('should list files in vault root', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'Content 2');
      await fs.writeFile(join(testVaultPath, 'note3.md'), 'Content 3');

      // Act
      const files = await client.listFiles();

      // Assert
      expect(files).toHaveLength(3);
      expect(files.map((f) => f.name).sort()).toEqual(['note1.md', 'note2.md', 'note3.md']);
      expect(files[0].isDirectory).toBe(false);
      expect(files[0].size).toBeGreaterThan(0);
      expect(files[0].modified).toBeInstanceOf(Date);
    });

    it('should list files in subdirectory', async () => {
      // Arrange
      await fs.mkdir(join(testVaultPath, 'subfolder'));
      await fs.writeFile(join(testVaultPath, 'subfolder', 'nested.md'), 'Content');

      // Act
      const files = await client.listFiles('subfolder');

      // Assert
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('nested.md');
      expect(files[0].path).toContain('subfolder');
    });

    it('should list files recursively', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'root.md'), 'Root');
      await fs.mkdir(join(testVaultPath, 'folder1'));
      await fs.writeFile(join(testVaultPath, 'folder1', 'note1.md'), 'Note 1');
      await fs.mkdir(join(testVaultPath, 'folder2'));
      await fs.writeFile(join(testVaultPath, 'folder2', 'note2.md'), 'Note 2');

      // Act
      const files = await client.listFiles('', true);

      // Assert
      expect(files).toHaveLength(3);
      expect(files.map((f) => f.name).sort()).toEqual(['note1.md', 'note2.md', 'root.md']);
    });

    it('should exclude non-markdown files', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note.md'), 'Markdown');
      await fs.writeFile(join(testVaultPath, 'image.png'), 'Image');
      await fs.writeFile(join(testVaultPath, 'doc.txt'), 'Text');

      // Act
      const files = await client.listFiles();

      // Assert
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('note.md');
    });

    it('should skip hidden directories', async () => {
      // Arrange
      await fs.mkdir(join(testVaultPath, '.hidden'));
      await fs.writeFile(join(testVaultPath, '.hidden', 'note.md'), 'Hidden');
      await fs.writeFile(join(testVaultPath, 'visible.md'), 'Visible');

      // Act
      const files = await client.listFiles('', true);

      // Assert
      expect(files).toHaveLength(1);
      expect(files[0].name).toBe('visible.md');
    });

    it('should return empty array for empty directory', async () => {
      // Arrange
      await fs.mkdir(join(testVaultPath, 'empty'));

      // Act
      const files = await client.listFiles('empty');

      // Assert
      expect(files).toEqual([]);
    });
  });

  describe('path validation', () => {
    it('should reject absolute paths', async () => {
      // Act & Assert
      await expect(client.readFile('/etc/passwd')).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
      });
    });

    it('should reject paths escaping vault with ..', async () => {
      // Act & Assert
      await expect(client.readFile('../../etc/passwd')).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
        message: expect.stringContaining('parent directory reference'),
      });
    });

    it('should allow ".." inside a filename (not a path segment)', async () => {
      await fs.writeFile(join(testVaultPath, 'notes..md'), 'dots');
      const result = await client.readFile('notes..md');
      expect(result.content).toBe('dots');
    });

    it('should reject listFiles on a folder outside the vault', async () => {
      await expect(client.listFiles('..', true)).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
      });
    });

    it('resolveSafePath should return vault root for empty input and reject escapes', () => {
      expect(client.resolveSafePath()).toBe(testVaultPath);
      expect(client.resolveSafePath('')).toBe(testVaultPath);
      expect(() => client.resolveSafePath('../x')).toThrow();
      expect(() => client.resolveSafePath('a/../../x')).toThrow();
    });

    it('should accept valid relative paths', async () => {
      // Arrange
      const testContent = '# Valid';
      await fs.mkdir(join(testVaultPath, 'valid'));
      await fs.writeFile(join(testVaultPath, 'valid', 'path.md'), testContent);

      // Act
      const result = await client.readFile('valid/path.md');

      // Assert
      expect(result.content).toBe(testContent);
    });
  });

  describe('getDailyNotePath', () => {
    const date = '2026-07-15';

    it('should default to the first candidate folder for a brand-new note', async () => {
      // Act - no daily-note folders exist yet
      const path = await client.getDailyNotePath(date);

      // Assert
      expect(path).toBe('Daily Notes/2026-07-15.md');
    });

    it('should use an existing folder over the default', async () => {
      // Arrange - only the "Daily" folder exists in the vault
      await fs.mkdir(join(testVaultPath, 'Daily'), { recursive: true });

      // Act
      const path = await client.getDailyNotePath(date);

      // Assert
      expect(path).toBe('Daily/2026-07-15.md');
    });

    it('should prefer a folder that already contains the note file', async () => {
      // Arrange - both folders exist, but the note lives in the lower-priority one
      await fs.mkdir(join(testVaultPath, 'Daily Notes'), { recursive: true });
      await fs.mkdir(join(testVaultPath, 'Daily'), { recursive: true });
      await fs.writeFile(join(testVaultPath, 'Daily', `${date}.md`), '# Existing');

      // Act
      const path = await client.getDailyNotePath(date);

      // Assert - existing file wins even though "Daily Notes" is listed first
      expect(path).toBe('Daily/2026-07-15.md');
    });

    it('should respect candidate folder ordering when multiple folders exist', async () => {
      // Arrange - both folders exist but neither has the note yet
      await fs.mkdir(join(testVaultPath, 'Daily Notes'), { recursive: true });
      await fs.mkdir(join(testVaultPath, 'Daily'), { recursive: true });

      // Act
      const path = await client.getDailyNotePath(date);

      // Assert - falls back to the first configured candidate
      expect(path).toBe('Daily Notes/2026-07-15.md');
    });

    it('should honor a custom candidate list from config', async () => {
      // Arrange - custom folder list with a single non-default folder
      const customConfig = { ...config, dailyNotesFolders: ['Journal'] as [string, ...string[]] };
      const customClient = new FileSystemClient(customConfig, logger, retryManager);

      // Act
      const path = await customClient.getDailyNotePath(date);

      // Assert
      expect(path).toBe('Journal/2026-07-15.md');
    });
  });

  describe('error handling with retry', () => {
    it('should retry on transient IO errors', async () => {
      // Arrange
      const testPath = 'retry-test.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Content');

      let attemptCount = 0;
      const originalReadFile = fs.readFile;

      // Mock fs.readFile to fail twice then succeed
      vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
        attemptCount++;
        if (attemptCount <= 2) {
          const error: NodeJS.ErrnoException = new Error('EAGAIN: resource temporarily unavailable');
          error.code = 'EAGAIN';
          throw error;
        }
        return originalReadFile.apply(fs, args);
      });

      // Act
      const result = await client.readFile(testPath);

      // Assert
      expect(result.content).toBe('Content');
      expect(attemptCount).toBe(3);

      // Cleanup
      vi.restoreAllMocks();
    });
  });
});
