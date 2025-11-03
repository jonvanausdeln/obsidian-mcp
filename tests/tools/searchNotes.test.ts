import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { SearchNotesTool } from '../../src/tools/searchNotes.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import type { Config } from '../../src/utils/config.js';
import type { Logger } from 'winston';

describe('SearchNotesTool', () => {
  let tool: SearchNotesTool;
  let client: FileSystemClient;
  let logger: Logger;
  let testVaultPath: string;

  beforeEach(async () => {
    // Create temporary test vault
    testVaultPath = join(process.cwd(), 'test-vault-searchnotes-' + Date.now());
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
    tool = new SearchNotesTool(client, logger);

    // Create test directory structure
    await fs.mkdir(join(testVaultPath, 'Work'), { recursive: true });
    await fs.mkdir(join(testVaultPath, 'Personal'), { recursive: true });
  });

  afterEach(async () => {
    // Clean up test vault
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  describe('tool metadata', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('search_notes');
    });

    it('should have descriptive description', () => {
      expect(tool.description).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(50);
      expect(tool.description).toContain('search');
    });

    it('should convert to MCP tool definition', () => {
      const mcpTool = tool.toMCPTool();

      expect(mcpTool.name).toBe('search_notes');
      expect(mcpTool.description).toBe(tool.description);
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
      expect(mcpTool.inputSchema.properties).toHaveProperty('query');
      expect(mcpTool.inputSchema.properties).toHaveProperty('caseSensitive');
      expect(mcpTool.inputSchema.properties).toHaveProperty('useRegex');
      expect(mcpTool.inputSchema.required).toContain('query');
    });
  });

  describe('basic search', () => {
    it('should find text in single note', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        '# Note 1\n\nThis contains the word TODO in it.'
      );

      // Act
      const result = await tool.execute({ query: 'TODO' });

      // Assert
      expect(result.totalMatches).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].path).toBe('note1.md');
      expect(result.results[0].matchCount).toBe(1);
      expect(result.results[0].matches[0].line).toBe(3);
    });

    it('should find multiple matches in single note', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        '# TODO List\n\n- TODO: Task 1\n- TODO: Task 2'
      );

      // Act
      const result = await tool.execute({ query: 'TODO' });

      // Assert
      expect(result.totalMatches).toBe(3);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].matchCount).toBe(3);
    });

    it('should find matches across multiple notes', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Important task');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'Another important item');
      await fs.writeFile(join(testVaultPath, 'note3.md'), 'Not relevant');

      // Act
      const result = await tool.execute({ query: 'important' });

      // Assert
      expect(result.totalMatches).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.searchedFiles).toBe(3);
    });

    it('should return empty results when no matches found', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Some content');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'Other content');

      // Act
      const result = await tool.execute({ query: 'nonexistent' });

      // Assert
      expect(result.totalMatches).toBe(0);
      expect(result.results).toHaveLength(0);
      expect(result.searchedFiles).toBe(2);
    });
  });

  describe('case sensitivity', () => {
    it('should be case-insensitive by default', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'TODO todo ToDo');

      // Act
      const result = await tool.execute({ query: 'todo' });

      // Assert
      expect(result.totalMatches).toBe(1); // All three matches on same line
    });

    it('should be case-sensitive when specified', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'TODO\ntodo\nToDo\nDone'
      );

      // Act
      const result = await tool.execute({ query: 'todo', caseSensitive: true });

      // Assert
      expect(result.totalMatches).toBe(1);
      expect(result.results[0].matches[0].content).toContain('todo');
    });
  });

  describe('regex search', () => {
    it('should support regex patterns', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Email: test@example.com\nInvalid: not-an-email'
      );

      // Act
      const result = await tool.execute({
        query: '\\S+@\\S+\\.\\S+',
        useRegex: true,
      });

      // Assert
      expect(result.totalMatches).toBe(1);
      expect(result.results[0].matches[0].content).toContain('@example.com');
    });

    it('should support regex flags', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), '2025-11-01\n2025-11-02');

      // Act
      const result = await tool.execute({
        query: '\\d{4}-\\d{2}-\\d{2}',
        useRegex: true,
      });

      // Assert
      expect(result.totalMatches).toBe(2);
    });

    it('should throw error for invalid regex', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Content');

      // Act & Assert
      await expect(
        tool.execute({
          query: '[invalid(regex',
          useRegex: true,
        })
      ).rejects.toThrow('Invalid regular expression');
    });

    it('should escape special characters in literal search', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Price: $100');

      // Act
      const result = await tool.execute({
        query: '$100',
        useRegex: false,
      });

      // Assert
      expect(result.totalMatches).toBe(1);
    });
  });

  describe('folder filtering', () => {
    it('should search only in specified folder', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'Work', 'work-note.md'), 'TODO: Work task');
      await fs.writeFile(join(testVaultPath, 'Personal', 'personal-note.md'), 'TODO: Personal task');

      // Act
      const result = await tool.execute({
        query: 'TODO',
        folder: 'Work',
      });

      // Assert
      expect(result.totalMatches).toBe(1);
      expect(result.results[0].path).toBe('Work/work-note.md');
      expect(result.searchedFiles).toBe(1);
    });

    it('should search recursively in subfolders', async () => {
      // Arrange
      await fs.mkdir(join(testVaultPath, 'Work', 'Projects'), { recursive: true });
      await fs.writeFile(join(testVaultPath, 'Work', 'main.md'), 'Important');
      await fs.writeFile(join(testVaultPath, 'Work', 'Projects', 'project.md'), 'Important project');

      // Act
      const result = await tool.execute({
        query: 'Important',
        folder: 'Work',
      });

      // Assert
      expect(result.totalMatches).toBe(2);
      expect(result.searchedFiles).toBe(2);
    });
  });

  describe('content and context', () => {
    it('should include matched line content by default', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2 with match\nLine 3'
      );

      // Act
      const result = await tool.execute({ query: 'match' });

      // Assert
      expect(result.results[0].matches[0].content).toBe('Line 2 with match');
    });

    it('should exclude content when includeContent is false', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2 with match\nLine 3'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        includeContent: false,
      });

      // Assert
      expect(result.results[0].matches[0].content).toBe('');
    });

    it('should include context lines before and after', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2\nLine 3 match\nLine 4\nLine 5'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        contextLines: 2,
      });

      // Assert
      const match = result.results[0].matches[0];
      expect(match.context?.before).toEqual(['Line 1', 'Line 2']);
      expect(match.context?.after).toEqual(['Line 4', 'Line 5']);
    });

    it('should handle context at start of file', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1 match\nLine 2\nLine 3'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        contextLines: 2,
      });

      // Assert
      const match = result.results[0].matches[0];
      expect(match.context?.before).toEqual([]);
      expect(match.context?.after).toEqual(['Line 2', 'Line 3']);
    });

    it('should handle context at end of file', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2\nLine 3 match'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        contextLines: 2,
      });

      // Assert
      const match = result.results[0].matches[0];
      expect(match.context?.before).toEqual(['Line 1', 'Line 2']);
      expect(match.context?.after).toEqual([]);
    });

    it('should support contextLines of 0', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2 match\nLine 3'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        contextLines: 0,
      });

      // Assert
      const match = result.results[0].matches[0];
      expect(match.context).toBeUndefined();
    });
  });

  describe('limit results', () => {
    it('should limit number of matches returned', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'match\nmatch\nmatch\nmatch\nmatch'
      );

      // Act
      const result = await tool.execute({
        query: 'match',
        limit: 3,
      });

      // Assert
      expect(result.results[0].matches).toHaveLength(3);
      expect(result.totalMatches).toBe(5);
    });

    it('should limit across multiple files', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'match\nmatch');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'match\nmatch');

      // Act
      const result = await tool.execute({
        query: 'match',
        limit: 3,
      });

      // Assert
      const totalReturned = result.results.reduce((sum, r) => sum + r.matches.length, 0);
      expect(totalReturned).toBe(3);
      expect(result.totalMatches).toBe(4);
    });
  });

  describe('line numbers', () => {
    it('should report correct line numbers (1-based)', async () => {
      // Arrange
      await fs.writeFile(
        join(testVaultPath, 'note1.md'),
        'Line 1\nLine 2 match\nLine 3\nLine 4 match'
      );

      // Act
      const result = await tool.execute({ query: 'match' });

      // Assert
      expect(result.results[0].matches[0].line).toBe(2);
      expect(result.results[0].matches[1].line).toBe(4);
    });
  });

  describe('match grouping', () => {
    it('should group matches by file', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'match\nmatch');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'match');

      // Act
      const result = await tool.execute({ query: 'match' });

      // Assert
      expect(result.results).toHaveLength(2);
      expect(result.results.find((r) => r.path === 'note1.md')?.matchCount).toBe(2);
      expect(result.results.find((r) => r.path === 'note2.md')?.matchCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty files', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'empty.md'), '');

      // Act
      const result = await tool.execute({ query: 'anything' });

      // Assert
      expect(result.totalMatches).toBe(0);
    });

    it('should handle files with no line breaks', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'single-line.md'), 'Single line with match');

      // Act
      const result = await tool.execute({ query: 'match' });

      // Assert
      expect(result.totalMatches).toBe(1);
      expect(result.results[0].matches[0].line).toBe(1);
    });

    it('should handle special characters in search query', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'Price: $50.00\nOther: €30');

      // Act
      const result = await tool.execute({
        query: '$50.00',
        useRegex: false,
      });

      // Assert
      expect(result.totalMatches).toBe(1);
    });

    it('should skip files that cannot be read', async () => {
      // Arrange
      await fs.writeFile(join(testVaultPath, 'note1.md'), 'match');
      await fs.writeFile(join(testVaultPath, 'note2.md'), 'match');

      // Make note2.md unreadable (this may not work on all systems)
      try {
        await fs.chmod(join(testVaultPath, 'note2.md'), 0o000);
      } catch {
        // Skip this test if we can't change permissions
      }

      // Act
      const result = await tool.execute({ query: 'match' });

      // Assert
      expect(result.totalMatches).toBeGreaterThan(0);
    });
  });

  describe('input validation', () => {
    it('should reject empty query', async () => {
      // Act & Assert
      await expect(tool.execute({ query: '' })).rejects.toThrow();
    });

    it('should reject negative contextLines', async () => {
      // Act & Assert
      await expect(
        tool.execute({ query: 'test', contextLines: -1 })
      ).rejects.toThrow();
    });

    it('should reject negative limit', async () => {
      // Act & Assert
      await expect(
        tool.execute({ query: 'test', limit: -1 })
      ).rejects.toThrow();
    });

    it('should reject zero limit', async () => {
      // Act & Assert
      await expect(
        tool.execute({ query: 'test', limit: 0 })
      ).rejects.toThrow();
    });
  });
});
