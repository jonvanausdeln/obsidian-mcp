import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../../src/tools/base.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Logger } from 'winston';
import type { Config } from '../../src/utils/config.js';

// Mock tool for testing
const TestInputSchema = z.object({
  value: z.string().min(1),
  optional: z.number().optional(),
});

type TestInput = z.infer<typeof TestInputSchema>;
type TestOutput = { result: string; doubled?: number };

class MockTool extends BaseTool<TestInput, TestOutput> {
  readonly name = 'mock_tool';
  readonly description = 'A mock tool for testing';
  protected readonly inputSchema = TestInputSchema;

  // Expose for testing
  public shouldThrowError = false;
  public executionCount = 0;

  protected async run(input: TestInput): Promise<TestOutput> {
    this.executionCount++;

    if (this.shouldThrowError) {
      throw new Error('Mock error');
    }

    return {
      result: input.value.toUpperCase(),
      doubled: input.optional ? input.optional * 2 : undefined,
    };
  }
}

describe('BaseTool', () => {
  let mockClient: FileSystemClient;
  let logger: Logger;
  let tool: MockTool;

  beforeEach(() => {
    // Create mock client (we won't actually use it)
    const mockConfig: Config = {
      vaultPath: '/tmp/test-vault',
      logLevel: 'error',
      maxFileSizeMB: 10,
      enableDelete: true,
      retryMaxAttempts: 3,
      retryBaseDelay: 100,
      verifySsl: false,
    };

    logger = initializeLogger(mockConfig);

    // We'll create a mock client to avoid filesystem operations
    mockClient = {} as FileSystemClient;

    tool = new MockTool(mockClient, logger);
  });

  describe('execute', () => {
    it('should execute successfully with valid input', async () => {
      // Arrange
      const input = { value: 'hello', optional: 5 };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result).toEqual({
        result: 'HELLO',
        doubled: 10,
      });
      expect(tool.executionCount).toBe(1);
    });

    it('should execute successfully without optional fields', async () => {
      // Arrange
      const input = { value: 'test' };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result).toEqual({
        result: 'TEST',
        doubled: undefined,
      });
    });

    it('should validate input and reject invalid data', async () => {
      // Arrange
      const invalidInput = { value: '', optional: 'not a number' };

      // Act & Assert
      await expect(tool.execute(invalidInput)).rejects.toThrow('Invalid input');
    });

    it('should reject missing required fields', async () => {
      // Arrange
      const invalidInput = { optional: 5 };

      // Act & Assert
      await expect(tool.execute(invalidInput)).rejects.toThrow('value: Required');
    });

    it('should handle execution errors', async () => {
      // Arrange
      tool.shouldThrowError = true;

      // Act & Assert
      await expect(tool.execute({ value: 'test' })).rejects.toMatchObject({
        type: ObsidianErrorType.UNKNOWN,
        message: 'Mock error',
      });
    });

    it('should log execution start and completion', async () => {
      // Arrange
      const debugSpy = vi.spyOn(logger, 'debug');
      const infoSpy = vi.spyOn(logger, 'info');

      // Act
      await tool.execute({ value: 'test' });

      // Assert
      expect(debugSpy).toHaveBeenCalledWith(
        'Executing tool: mock_tool',
        expect.objectContaining({ input: { value: 'test' } })
      );
      expect(infoSpy).toHaveBeenCalledWith('Tool mock_tool completed successfully');
    });

    it('should log errors on failure', async () => {
      // Arrange
      const errorSpy = vi.spyOn(logger, 'error');
      tool.shouldThrowError = true;

      // Act & Assert
      await expect(tool.execute({ value: 'test' })).rejects.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(
        'Tool mock_tool failed',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });
  });

  describe('toMCPTool', () => {
    it('should convert to MCP tool definition', () => {
      // Act
      const mcpTool = tool.toMCPTool();

      // Assert
      expect(mcpTool.name).toBe('mock_tool');
      expect(mcpTool.description).toBe('A mock tool for testing');
      expect(mcpTool.inputSchema).toBeDefined();
      expect(mcpTool.inputSchema.type).toBe('object');
    });

    it('should include schema properties', () => {
      // Act
      const mcpTool = tool.toMCPTool();

      // Assert
      expect(mcpTool.inputSchema.properties).toBeDefined();
      expect(mcpTool.inputSchema.properties).toHaveProperty('value');
      expect(mcpTool.inputSchema.properties).toHaveProperty('optional');
    });

    it('should include required fields', () => {
      // Act
      const mcpTool = tool.toMCPTool();

      // Assert
      expect(mcpTool.inputSchema.required).toBeDefined();
      expect(mcpTool.inputSchema.required).toContain('value');
      expect(mcpTool.inputSchema.required).not.toContain('optional');
    });

    it('should inline schemas without $ref', () => {
      // Act
      const mcpTool = tool.toMCPTool();

      // Assert
      const schemaString = JSON.stringify(mcpTool.inputSchema);
      expect(schemaString).not.toContain('$ref');
    });
  });

  describe('input validation', () => {
    it('should accept valid complex input', async () => {
      // Arrange
      const input = { value: 'complex test', optional: 42 };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result.result).toBe('COMPLEX TEST');
      expect(result.doubled).toBe(84);
    });

    it('should handle type coercion according to schema', async () => {
      // Arrange - Zod will NOT coerce string to number by default
      const input = { value: 'test', optional: 3.14 };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result.doubled).toBe(6.28);
    });

    it('should provide clear error messages for validation failures', async () => {
      // Arrange
      const input = { value: '' }; // Empty string violates min(1)

      // Act & Assert
      await expect(tool.execute(input)).rejects.toMatchObject({
        message: expect.stringContaining('String must contain at least 1 character'),
      });
    });

    it('should handle multiple validation errors', async () => {
      // Arrange
      const input = { value: '', optional: 'not a number' };

      // Act & Assert
      const promise = tool.execute(input);
      await expect(promise).rejects.toThrow('Invalid input');
    });

    it('should accept null/undefined for optional fields', async () => {
      // Arrange
      const input = { value: 'test', optional: undefined };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result.doubled).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should categorize errors correctly', async () => {
      // Arrange
      tool.shouldThrowError = true;

      // Act & Assert
      await expect(tool.execute({ value: 'test' })).rejects.toMatchObject({
        type: ObsidianErrorType.UNKNOWN,
        message: 'Mock error',
      });
    });

    it('should preserve error context', async () => {
      // Arrange
      tool.shouldThrowError = true;

      // Act & Assert
      await expect(tool.execute({ value: 'test' })).rejects.toMatchObject({
        details: expect.objectContaining({
          originalError: expect.any(Error),
        }),
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty object input when all fields optional', async () => {
      // Create a tool with all optional fields
      const AllOptionalSchema = z.object({
        a: z.string().optional(),
        b: z.number().optional(),
      });

      class AllOptionalTool extends BaseTool<z.infer<typeof AllOptionalSchema>, { ok: boolean }> {
        readonly name = 'all_optional';
        readonly description = 'All fields optional';
        protected readonly inputSchema = AllOptionalSchema;

        protected async run(): Promise<{ ok: boolean }> {
          return { ok: true };
        }
      }

      const optionalTool = new AllOptionalTool(mockClient, logger);

      // Act
      const result = await optionalTool.execute({});

      // Assert
      expect(result).toEqual({ ok: true });
    });

    it('should handle very long input strings', async () => {
      // Arrange
      const longString = 'x'.repeat(10000);
      const input = { value: longString };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result.result).toBe(longString.toUpperCase());
      expect(result.result.length).toBe(10000);
    });

    it('should handle special characters in strings', async () => {
      // Arrange
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const input = { value: specialChars };

      // Act
      const result = await tool.execute(input);

      // Assert
      expect(result.result).toBe(specialChars.toUpperCase());
    });
  });
});
