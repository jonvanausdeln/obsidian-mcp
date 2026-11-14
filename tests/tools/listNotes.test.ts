import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ListNotesTool } from '../../src/tools/listNotes.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('ListNotesTool', () => {
  let tool: ListNotesTool;
  let client: FileSystemClient;
  let logger: Logger;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-listnotes-' + Date.now());
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
    tool = new ListNotesTool(client, logger);

    // Create test directory structure
    await fs.mkdir(join(testVaultPath, 'Folder1'), { recursive: true });
    await fs.mkdir(join(testVaultPath, 'Folder1', 'Subfolder'), { recursive: true });
    await fs.mkdir(join(testVaultPath, 'Folder2'), { recursive: true });
    await fs.mkdir(join(testVaultPath, 'Daily Notes'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('list_notes');
    });

    it('should have descriptive description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.description).toContain('filter');
    });

    it('should convert to MCP tool definition', () => {
      const mcpTool = tool.toMCPTool();

      expect(mcpTool.name).toBe('list_notes');
      expect(mcpTool.description).toBe(tool.description);
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
      expect(mcpTool.inputSchema.properties).toHaveProperty('folder');
      expect(mcpTool.inputSchema.properties).toHaveProperty('recursive');
      expect(mcpTool.inputSchema.properties).toHaveProperty('pattern');
      expect(mcpTool.inputSchema.properties).toHaveProperty('sortBy');
    });
  });

  describe('list all notes', () => {
    it('should list all notes in vault', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'Content 2');
      await fs.writeFile(join(testVaultPath, 'Folder1', 'note3.md'), 'Content 3');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.filtered).toBe(3);
      expect(result.notes.map((n) => n.path).sort()).toEqual([
        'Folder1/note3.md',
        'note1.md',
        'note2.md',
      ]);
    });

    it('should return empty array for empty vault', async () => {
      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.filtered).toBe(0);
    });

    it('should skip .obsidian directory', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, '.obsidian', 'workspace.json'), '{}');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('note1.md');
    });

    it('should only include .md files', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'document.txt'), 'Text file');
      await fs.writeFile(join(testVaultPath, 'image.png'), 'Binary');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('note1.md');
    });
  });

  describe('folder filtering', () => {
    it('should list notes in specific folder', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'root.md'), 'Root');
      await fs.writeFile(join(testVaultPath, 'Folder1', 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'Folder2', 'note2.md'), 'Content 2');

      // Act
      const result = await tool.execute({ folder: 'Folder1' });

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('Folder1/note1.md');
    });

    it('should throw error for non-existent folder', async () => {
      // Act & Assert
      await expect(tool.execute({ folder: 'NonExistent' })).rejects.toThrow();
    });

    it('should reject folders that escape the vault', async () => {
      // The test vault lives inside the repo, so "../" would list the repo's own .md files
      for (const folder of ['..', '../', 'Folder1/../..', '..\\']) {
        await expect(tool.execute({ folder })).rejects.toMatchObject({
          type: ObsidianErrorType.INVALID_PATH,
        });
      }
    });
  });

  describe('recursive listing', () => {
    it('should list notes recursively by default', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Folder1', 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'Folder1', 'Subfolder', 'note2.md'), 'Content 2');

      // Act
      const result = await tool.execute({ folder: 'Folder1' });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.path).sort()).toEqual([
        'Folder1/Subfolder/note2.md',
        'Folder1/note1.md',
      ]);
    });

    it('should list notes non-recursively when recursive=false', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Folder1', 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'Folder1', 'Subfolder', 'note2.md'), 'Content 2');

      // Act
      const result = await tool.execute({ folder: 'Folder1', recursive: false });

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('Folder1/note1.md');
    });
  });

  describe('pattern matching', () => {
    it('should filter notes by glob pattern', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note-2025.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'note-2024.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'other.md'), 'Content');

      // Act
      const result = await tool.execute({ pattern: '*2025*' });

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('note-2025.md');
    });

    it('should support wildcard patterns', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'daily-01.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'daily-02.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'weekly.md'), 'Content');

      // Act
      const result = await tool.execute({ pattern: 'daily-*.md' });

      // Assert
      expect(result.notes).toHaveLength(2);
    });

    it('should match pattern in subfolder paths', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Folder1', 'test.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Folder2', 'test.md'), 'Content');

      // Act
      const result = await tool.execute({ pattern: 'Folder1/*.md' });

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('Folder1/test.md');
    });
  });

  describe('sorting', () => {
    it('should sort by name ascending by default', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'charlie.md'), 'C');
      await fs.writeFile(join(testVaultPath, 'alpha.md'), 'A');
      await fs.writeFile(join(testVaultPath, 'bravo.md'), 'B');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes.map((n) => n.path)).toEqual(['alpha.md', 'bravo.md', 'charlie.md']);
    });

    it('should sort by name descending', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'charlie.md'), 'C');
      await fs.writeFile(join(testVaultPath, 'alpha.md'), 'A');
      await fs.writeFile(join(testVaultPath, 'bravo.md'), 'B');

      // Act
      const result = await tool.execute({ sortBy: 'name', order: 'desc' });

      // Assert
      expect(result.notes.map((n) => n.path)).toEqual(['charlie.md', 'bravo.md', 'alpha.md']);
    });

    it('should sort by size', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'large.md'), 'A'.repeat(1000));
      await fs.writeFile(join(testVaultPath, 'small.md'), 'A');
      await fs.writeFile(join(testVaultPath, 'medium.md'), 'A'.repeat(100));

      // Act
      const result = await tool.execute({ sortBy: 'size', order: 'asc' });

      // Assert
      expect(result.notes.map((n) => n.path)).toEqual(['small.md', 'medium.md', 'large.md']);
    });

    it('should sort by modified date', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'first.md'), 'Content');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(join(testVaultPath, 'second.md'), 'Content');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(join(testVaultPath, 'third.md'), 'Content');

      // Act
      const result = await tool.execute({ sortBy: 'modified', order: 'asc' });

      // Assert
      expect(result.notes.map((n) => n.path)).toEqual(['first.md', 'second.md', 'third.md']);
    });
  });

  describe('limit results', () => {
    it('should limit number of results', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content 1');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'Content 2');
      await fs.writeFile(join(testVaultPath, 'note3.md'), 'Content 3');
      await fs.writeFile(join(testVaultPath, 'note4.md'), 'Content 4');

      // Act
      const result = await tool.execute({ limit: 2 });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.total).toBe(4);
      expect(result.filtered).toBe(4);
    });

    it('should respect limit after sorting', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'charlie.md'), 'C');
      await fs.writeFile(join(testVaultPath, 'alpha.md'), 'A');
      await fs.writeFile(join(testVaultPath, 'bravo.md'), 'B');

      // Act
      const result = await tool.execute({ sortBy: 'name', order: 'asc', limit: 2 });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.path)).toEqual(['alpha.md', 'bravo.md']);
    });
  });

  describe('date range filtering', () => {
    it('should filter by start date', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-10-30.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-01.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-02.md'), 'Content');

      // Act
      const result = await tool.execute({
        folder: 'Daily Notes',
        dateRange: { start: '2025-11-01' },
      });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.path).sort()).toEqual([
        'Daily Notes/2025-11-01.md',
        'Daily Notes/2025-11-02.md',
      ]);
    });

    it('should filter by end date', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-10-30.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-01.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-02.md'), 'Content');

      // Act
      const result = await tool.execute({
        folder: 'Daily Notes',
        dateRange: { end: '2025-11-01' },
      });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.path).sort()).toEqual([
        'Daily Notes/2025-10-30.md',
        'Daily Notes/2025-11-01.md',
      ]);
    });

    it('should filter by date range', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-10-28.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-10-30.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-01.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-05.md'), 'Content');

      // Act
      const result = await tool.execute({
        folder: 'Daily Notes',
        dateRange: { start: '2025-10-30', end: '2025-11-01' },
      });

      // Assert
      expect(result.notes).toHaveLength(2);
      expect(result.notes.map((n) => n.path).sort()).toEqual([
        'Daily Notes/2025-10-30.md',
        'Daily Notes/2025-11-01.md',
      ]);
    });

    it('should exclude notes without dates in filename', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Daily Notes', '2025-11-01.md'), 'Content');
      await fs.writeFile(join(testVaultPath, 'Daily Notes', 'template.md'), 'Content');

      // Act
      const result = await tool.execute({
        folder: 'Daily Notes',
        dateRange: { start: '2025-11-01' },
      });

      // Assert
      expect(result.notes).toHaveLength(1);
      expect(result.notes[0].path).toBe('Daily Notes/2025-11-01.md');
    });
  });

  describe('note metadata', () => {
    it('should include size in metadata', async () => {
      // Arrange
      const content = 'Test content';
      await fs.writeFile(join(testVaultPath, 'test.md'), content);

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes[0].size).toBe(content.length);
    });

    it('should include timestamps in ISO format', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'test.md'), 'Content');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes[0].modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result.notes[0].created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should normalize path separators', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Folder1', 'note.md'), 'Content');

      // Act
      const result = await tool.execute({});

      // Assert
      expect(result.notes[0].path).toBe('Folder1/note.md'); // Forward slashes
    });
  });

  describe('input validation', () => {
    it('should reject negative limit', async () => {
      // Act & Assert
      await expect(tool.execute({ limit: -1 })).rejects.toThrow();
    });

    it('should reject zero limit', async () => {
      // Act & Assert
      await expect(tool.execute({ limit: 0 })).rejects.toThrow();
    });

    it('should reject invalid sortBy value', async () => {
      // Act & Assert
      await expect(
        tool.execute({ sortBy: 'invalid' as any })
      ).rejects.toThrow();
    });

    it('should reject invalid order value', async () => {
      // Act & Assert
      await expect(
        tool.execute({ order: 'invalid' as any })
      ).rejects.toThrow();
    });
  });
});
