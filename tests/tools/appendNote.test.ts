import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { AppendNoteTool } from '../../src/tools/appendNote.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('AppendNoteTool', () => {
  let tool: AppendNoteTool;
  let client: FileSystemClient;
  let logger: Logger;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-appendnote-' + Date.now());
    await fs.mkdir(testVaultPath, { recursive: true });
    await fs.mkdir(join(testVaultPath, '.obsidian'), { recursive: true });

    // Create config
    const config: Config = {
      vaultPath: testVaultPath,
      logLevel: 'error',
      maxFileSizeMB: 1,
      enableDelete: true,
      retryMaxAttempts: 3,
      retryBaseDelay: 10,
      verifySsl: false,
    };

    logger = initializeLogger(config);
    const retryManager = new RetryManager(
      {
        maxAttempts: config.retryMaxAttempts,
        baseDelay: config.retryBaseDelay,
      },
      logger
    );

    client = new FileSystemClient(config, logger, retryManager);
    tool = new AppendNoteTool(client, logger);
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('append_note');
    });

    it('should have descriptive description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.description.toLowerCase()).toContain('append');
    });

    it('should convert to MCP tool definition', () => {
      const mcpTool = tool.toMCPTool();

      expect(mcpTool.name).toBe('append_note');
      expect(mcpTool.inputSchema.properties).toHaveProperty('path');
      expect(mcpTool.inputSchema.properties).toHaveProperty('content');
      expect(mcpTool.inputSchema.properties).toHaveProperty('separator');
      expect(mcpTool.inputSchema.properties).toHaveProperty('timestamp');
      expect(mcpTool.inputSchema.required).toContain('path');
      expect(mcpTool.inputSchema.required).toContain('content');
    });
  });

  describe('basic append', () => {
    it('should append content to existing note', async () => {
      // Arrange
      const testPath = 'append-test.md';
      const initialContent = '# Note\n\nFirst paragraph.';
      await fs.writeFile(join(testVaultPath, testPath), initialContent);

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'Second paragraph.',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.newLength).toBeGreaterThan(initialContent.length);

      // Verify content
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(initialContent + '\n\n' + 'Second paragraph.');
    });

    it('should use custom separator', async () => {
      // Arrange
      const testPath = 'separator.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Line 1');

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'Line 2',
        separator: '\n---\n',
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('Line 1\n---\nLine 2');
    });

    it('should handle empty separator', async () => {
      // Arrange
      const testPath = 'no-separator.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Part1');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Part2',
        separator: '',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('Part1Part2');
    });

    it('should handle single newline separator', async () => {
      // Arrange
      const testPath = 'single-newline.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Line 1');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Line 2',
        separator: '\n',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('Line 1\nLine 2');
    });
  });

  describe('timestamp feature', () => {
    beforeEach(() => {
      // Mock Date for consistent testing
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-11-01T14:30:00'));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should add timestamp when timestamp is true', async () => {
      // Arrange
      const testPath = 'timestamp.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Note\n');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Work completed',
        timestamp: true,
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('2:30 PM - Work completed');
    });

    it('should not add timestamp when timestamp is false', async () => {
      // Arrange
      const testPath = 'no-timestamp.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Note\n');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Work completed',
        timestamp: false,
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).not.toContain('PM');
      expect(content).not.toContain('AM');
      expect(content).toContain('Work completed');
    });

    it('should not add timestamp by default', async () => {
      // Arrange
      const testPath = 'default.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Note\n');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Work completed',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).not.toContain('PM');
      expect(content).toContain('Work completed');
    });
  });

  describe('error handling', () => {
    it('should throw FILE_NOT_FOUND for non-existent file', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: 'missing.md',
          content: 'content',
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
      });
    });

    it('should throw INVALID_PATH for path traversal', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: '../../../etc/passwd',
          content: 'hack',
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
      });
    });

    it('should reject empty path', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: '',
          content: 'content',
        })
      ).rejects.toThrow('Path is required');
    });

    it('should reject missing content', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: 'test.md',
        } as any)
      ).rejects.toThrow();
    });
  });

  describe('multiple appends', () => {
    it('should handle multiple appends sequentially', async () => {
      // Arrange
      const testPath = 'multi-append.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Start');

      // Act
      await tool.execute({ path: testPath, content: 'Entry 1' });
      await tool.execute({ path: testPath, content: 'Entry 2' });
      await tool.execute({ path: testPath, content: 'Entry 3' });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('Start');
      expect(content).toContain('Entry 1');
      expect(content).toContain('Entry 2');
      expect(content).toContain('Entry 3');
    });

    it('should grow file size with each append', async () => {
      // Arrange
      const testPath = 'growing.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Start');

      // Act
      const result1 = await tool.execute({ path: testPath, content: 'Entry 1' });
      const result2 = await tool.execute({ path: testPath, content: 'Entry 2' });

      // Assert
      expect(result2.newLength).toBeGreaterThan(result1.newLength);
    });
  });

  describe('special content', () => {
    it('should handle Unicode content', async () => {
      // Arrange
      const testPath = 'unicode.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Start\n');

      // Act
      await tool.execute({
        path: testPath,
        content: '日本語 🌍',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('日本語 🌍');
    });

    it('should handle markdown formatting', async () => {
      // Arrange
      const testPath = 'markdown.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Note\n');

      // Act
      await tool.execute({
        path: testPath,
        content: '**Bold** *italic* `code` [[link]] #tag',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('**Bold**');
      expect(content).toContain('[[link]]');
    });

    it('should handle multiline content', async () => {
      // Arrange
      const testPath = 'multiline.md';
      await fs.writeFile(join(testVaultPath, testPath), '# Note\n');

      // Act
      await tool.execute({
        path: testPath,
        content: 'Line 1\nLine 2\nLine 3',
      });

      // Assert
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('Line 1\nLine 2\nLine 3');
    });
  });

  describe('nested directories', () => {
    it('should append to note in subdirectory', async () => {
      // Arrange
      const testPath = 'folder/subfolder/note.md';
      await fs.mkdir(join(testVaultPath, 'folder', 'subfolder'), { recursive: true });
      await fs.writeFile(join(testVaultPath, testPath), 'Initial');

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'Appended',
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('Initial');
      expect(content).toContain('Appended');
    });

    it('should handle Windows-style paths', async () => {
      // Arrange
      await fs.mkdir(join(testVaultPath, 'folder'));
      const testPath = 'folder\\note.md';
      await fs.writeFile(join(testVaultPath, 'folder', 'note.md'), 'Content');

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'More',
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
