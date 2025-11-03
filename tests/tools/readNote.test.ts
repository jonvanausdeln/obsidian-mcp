import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ReadNoteTool } from '../../src/tools/readNote.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('ReadNoteTool', () => {
  let tool: ReadNoteTool;
  let client: FileSystemClient;
  let logger: Logger;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-readnote-' + Date.now());
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
    tool = new ReadNoteTool(client, logger);
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('read_note');
    });

    it('should have descriptive description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
    });

    it('should convert to MCP tool definition', () => {
      const mcpTool = tool.toMCPTool();

      expect(mcpTool.name).toBe('read_note');
      expect(mcpTool.description).toBe(tool.description);
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
      expect(mcpTool.inputSchema.properties).toHaveProperty('path');
      expect(mcpTool.inputSchema.required).toContain('path');
    });
  });

  describe('execute', () => {
    it('should read a simple note', async () => {
      // Arrange
      const testContent = '# My Note\n\nThis is a test note.';
      const testPath = 'test-note.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.stats.size).toBe(testContent.length);
      expect(result.stats.modified).toBeInstanceOf(Date);
      expect(result.stats.created).toBeInstanceOf(Date);
    });

    it('should read a note with frontmatter', async () => {
      // Arrange
      const testContent = `---
title: My Note
tags: [test, example]
---

# Content

This note has frontmatter.`;
      const testPath = 'with-frontmatter.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.content).toContain('---');
      expect(result.content).toContain('title: My Note');
    });

    it('should read a note in a subdirectory', async () => {
      // Arrange
      const testContent = '# Nested Note';
      const testPath = 'folder/subfolder/nested.md';
      await fs.mkdir(join(testVaultPath, 'folder', 'subfolder'), { recursive: true });
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
    });

    it('should read an empty note', async () => {
      // Arrange
      const testPath = 'empty.md';
      await fs.writeFile(join(testVaultPath, testPath), '');

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe('');
      expect(result.stats.size).toBe(0);
    });

    it('should read a note with special characters', async () => {
      // Arrange
      const testContent = '# Special Characters\n\n- Emoji: 🎉\n- Unicode: 你好\n- Symbols: €£¥';
      const testPath = 'special.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent, 'utf-8');

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.content).toContain('🎉');
      expect(result.content).toContain('你好');
    });

    it('should handle Windows-style paths', async () => {
      // Arrange
      const testContent = '# Test';
      await fs.mkdir(join(testVaultPath, 'windows'), { recursive: true });
      await fs.writeFile(join(testVaultPath, 'windows', 'path.md'), testContent);

      // Act
      const result = await tool.execute({ path: 'windows\\path.md' });

      // Assert
      expect(result.content).toBe(testContent);
    });

    it('should read a large note within size limit', async () => {
      // Arrange
      const testContent = '# Large Note\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(10000);
      const testPath = 'large.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.stats.size).toBeGreaterThan(100000);
    });
  });

  describe('error handling', () => {
    it('should throw FILE_NOT_FOUND for non-existent note', async () => {
      // Act & Assert
      await expect(tool.execute({ path: 'non-existent.md' })).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_NOT_FOUND,
        message: expect.stringContaining('File not found'),
      });
    });

    it('should throw INVALID_PATH for path traversal attempt', async () => {
      // Act & Assert
      await expect(tool.execute({ path: '../../../etc/passwd' })).rejects.toMatchObject({
        type: ObsidianErrorType.INVALID_PATH,
        message: expect.stringContaining('parent directory reference'),
      });
    });

    it('should throw FILE_TOO_LARGE for oversized files', async () => {
      // Arrange - create 2MB file (exceeds 1MB limit)
      const largeContent = 'x'.repeat(2 * 1024 * 1024);
      const testPath = 'too-large.md';
      await fs.writeFile(join(testVaultPath, testPath), largeContent);

      // Act & Assert
      await expect(tool.execute({ path: testPath })).rejects.toMatchObject({
        type: ObsidianErrorType.FILE_TOO_LARGE,
        message: expect.stringContaining('exceeds limit'),
      });
    });

    it('should reject empty path', async () => {
      // Act & Assert
      await expect(tool.execute({ path: '' })).rejects.toThrow('Path is required');
    });

    it('should reject missing path parameter', async () => {
      // Act & Assert
      await expect(tool.execute({})).rejects.toThrow();
    });

    it('should reject invalid input type', async () => {
      // Act & Assert
      await expect(tool.execute({ path: 123 })).rejects.toThrow();
    });

    it('should reject null path', async () => {
      // Act & Assert
      await expect(tool.execute({ path: null })).rejects.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should read multiple notes sequentially', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), '# Note 1');
      await fs.writeFile(join(testVaultPath, 'note2.md'), '# Note 2');
      await fs.writeFile(join(testVaultPath, 'note3.md'), '# Note 3');

      // Act
      const results = await Promise.all([
        tool.execute({ path: 'note1.md' }),
        tool.execute({ path: 'note2.md' }),
        tool.execute({ path: 'note3.md' }),
      ]);

      // Assert
      expect(results).toHaveLength(3);
      expect(results[0].content).toBe('# Note 1');
      expect(results[1].content).toBe('# Note 2');
      expect(results[2].content).toBe('# Note 3');
    });

    it('should preserve exact content including whitespace', async () => {
      // Arrange
      const testContent = `# Title

Paragraph 1.

Paragraph 2.


Extra blank lines above.

  - Indented list
    - Nested item

\tTab character here.

End of file.`;
      const testPath = 'whitespace.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act
      const result = await tool.execute({ path: testPath });

      // Assert
      expect(result.content).toBe(testContent);
      expect(result.content).toContain('\t');
      expect(result.content).toContain('  - Indented list'); // Indented content
    });

    it('should work with notes that have no file extension', async () => {
      // Note: The FileSystemClient doesn't enforce .md extension
      // It can read any file in the vault
      const testContent = '# Test';
      await fs.writeFile(join(testVaultPath, 'note'), testContent);

      // Act
      const result = await tool.execute({ path: 'note' });

      // Assert
      expect(result.content).toBe(testContent);
    });

    it('should handle concurrent reads of same file', async () => {
      // Arrange
      const testContent = '# Concurrent Test';
      const testPath = 'concurrent.md';
      await fs.writeFile(join(testVaultPath, testPath), testContent);

      // Act - read same file 5 times concurrently
      const results = await Promise.all(
        Array(5)
          .fill(null)
          .map(() => tool.execute({ path: testPath }))
      );

      // Assert
      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.content).toBe(testContent);
      });
    });
  });
});
