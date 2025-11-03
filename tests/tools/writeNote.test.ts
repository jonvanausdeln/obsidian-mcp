import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { WriteNoteTool } from '../../src/tools/writeNote.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('WriteNoteTool', () => {
  let tool: WriteNoteTool;
  let client: FileSystemClient;
  let logger: Logger;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-writenote-' + Date.now());
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
    tool = new WriteNoteTool(client, logger);
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('write_note');
    });

    it('should have descriptive description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.description).toContain('overwrite');
    });

    it('should convert to MCP tool definition', () => {
      const mcpTool = tool.toMCPTool();

      expect(mcpTool.name).toBe('write_note');
      expect(mcpTool.description).toBe(tool.description);
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
      expect(mcpTool.inputSchema.properties).toHaveProperty('path');
      expect(mcpTool.inputSchema.properties).toHaveProperty('content');
      expect(mcpTool.inputSchema.properties).toHaveProperty('overwrite');
      expect(mcpTool.inputSchema.properties).toHaveProperty('createDirs');
      expect(mcpTool.inputSchema.required).toContain('path');
      expect(mcpTool.inputSchema.required).toContain('content');
    });
  });

  describe('create new note', () => {
    it('should create a new note with content', async () => {
      // Arrange
      const testContent = '# New Note\n\nThis is a new note.';
      const testPath = 'new-note.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);
      expect(result.path).toBe(testPath);

      // Verify file was created
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should create note with frontmatter', async () => {
      // Arrange
      const testContent = `---
title: Test Note
tags: [test]
---

# Test Note

Content here.`;
      const testPath = 'frontmatter-note.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('title: Test Note');
    });

    it('should create note in nested directory', async () => {
      // Arrange
      const testContent = '# Nested Note';
      const testPath = 'folder/subfolder/nested.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
        createDirs: true,
      });

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
      await expect(
        tool.execute({
          path: testPath,
          content: testContent,
          createDirs: false,
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
      });
    });

    it('should create empty note', async () => {
      // Arrange
      const testPath = 'empty.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: '',
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('');
    });
  });

  describe('overwrite protection', () => {
    it('should prevent overwrite by default', async () => {
      // Arrange
      const testPath = 'existing.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Original content');

      // Act & Assert
      await expect(
        tool.execute({
          path: testPath,
          content: 'New content',
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.PERMISSION_DENIED,
        message: expect.stringContaining('already exists'),
      });

      // Verify original content is preserved
      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('Original content');
    });

    it('should prevent overwrite when overwrite is explicitly false', async () => {
      // Arrange
      const testPath = 'existing.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Original');

      // Act & Assert
      await expect(
        tool.execute({
          path: testPath,
          content: 'New',
          overwrite: false,
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.PERMISSION_DENIED,
      });
    });

    it('should allow overwrite when overwrite is true', async () => {
      // Arrange
      const testPath = 'existing.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Original content');

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'New content',
        overwrite: true,
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.created).toBe(false);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe('New content');
    });

    it('should provide helpful error message when overwrite is needed', async () => {
      // Arrange
      const testPath = 'exists.md';
      await fs.writeFile(join(testVaultPath, testPath), 'Content');

      // Act & Assert
      try {
        await tool.execute({
          path: testPath,
          content: 'New',
        });
        throw new Error('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('already exists');
        expect(error.message).toContain('overwrite: true');
        expect(error.details?.suggestedAction).toBeTruthy();
      }
    });
  });

  describe('path validation', () => {
    it('should reject paths with parent directory reference', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: '../../../etc/passwd',
          content: 'hack',
        })
      ).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
        message: expect.stringContaining('parent directory reference'),
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

    it('should accept valid relative paths', async () => {
      // Arrange
      const testContent = '# Valid Path';
      const testPath = 'valid/path/to/note.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
        createDirs: true,
      });

      // Assert
      expect(result.success).toBe(true);
    });

    it('should handle Windows-style paths', async () => {
      // Arrange
      const testContent = '# Windows Path';
      const testPath = 'folder\\note.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
        createDirs: true,
      });

      // Assert
      expect(result.success).toBe(true);

      // Verify file exists
      const exists = await fs
        .access(join(testVaultPath, 'folder', 'note.md'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('special content', () => {
    it('should handle Unicode characters', async () => {
      // Arrange
      const testContent = '# 日本語 🌍\n\nこんにちは世界！';
      const testPath = 'unicode.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should handle special markdown characters', async () => {
      // Arrange
      const testContent = '# Special\n\n[[Links]] #tags `code` **bold** *italic*';
      const testPath = 'special.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });

    it('should preserve whitespace and line endings', async () => {
      // Arrange
      const testContent = 'Line 1\n\nLine 3 with spaces  \nLine 4\t\twith tabs';
      const testPath = 'whitespace.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content).toBe(testContent);
    });
  });

  describe('input validation', () => {
    it('should reject missing path', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          content: 'content',
        } as any)
      ).rejects.toThrow();
    });

    it('should reject missing content', async () => {
      // Act & Assert
      await expect(
        tool.execute({
          path: 'test.md',
        } as any)
      ).rejects.toThrow();
    });

    it('should accept optional parameters with defaults', async () => {
      // Arrange
      const testPath = 'defaults.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'Content',
        // overwrite and createDirs should use defaults
      });

      // Assert
      expect(result.success).toBe(true);
    });

    it('should handle explicit false for optional boolean', async () => {
      // Arrange - no need to create directory
      await fs.mkdir(join(testVaultPath, 'exists'));
      const testPath = 'exists/note.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: 'Content',
        createDirs: false, // Explicitly false
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle very long content', async () => {
      // Arrange
      const longContent = '# Long\n\n' + 'x'.repeat(100000);
      const testPath = 'long.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: longContent,
      });

      // Assert
      expect(result.success).toBe(true);

      const content = await fs.readFile(join(testVaultPath, testPath), 'utf-8');
      expect(content.length).toBe(longContent.length);
    });

    it('should handle filenames with special characters', async () => {
      // Arrange
      const testContent = '# Note';
      const testPath = 'note with spaces & special!.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
      });

      // Assert
      expect(result.success).toBe(true);
    });

    it('should handle deeply nested directories', async () => {
      // Arrange
      const testContent = '# Deep';
      const testPath = 'a/b/c/d/e/f/deep.md';

      // Act
      const result = await tool.execute({
        path: testPath,
        content: testContent,
        createDirs: true,
      });

      // Assert
      expect(result.success).toBe(true);
    });
  });
});
