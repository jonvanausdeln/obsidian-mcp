import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Logger } from 'winston';
import type { ObsidianClient } from '../obsidian/client.js';
import { categorizeError } from '../obsidian/errorHandler.js';
import type { ObsidianError } from '../types/obsidian.js';

/**
 * MCP Tool definition that will be returned to the client
 */
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

/**
 * Abstract base class for all Obsidian MCP tools
 *
 * Provides a consistent structure for:
 * - Input validation using Zod schemas
 * - Error handling with categorization
 * - Logging integration
 * - MCP tool definition generation
 *
 * Usage:
 * ```typescript
 * export class MyTool extends BaseTool<MyInputType, MyOutputType> {
 *   name = 'my_tool';
 *   description = 'Does something useful';
 *   protected inputSchema = z.object({ ... });
 *
 *   protected async run(input: MyInputType): Promise<MyOutputType> {
 *     // Implementation
 *   }
 * }
 * ```
 */
export abstract class BaseTool<TInput, TOutput> {
  /**
   * Tool name - must be unique across all tools
   * Should use snake_case (e.g., 'read_note', 'search_notes')
   */
  abstract readonly name: string;

  /**
   * Human-readable description of what the tool does
   * This will be shown to the LLM to help it decide when to use the tool
   */
  abstract readonly description: string;

  /**
   * Zod schema for input validation
   * Will be converted to JSON Schema for MCP
   * Uses any for input type to allow schemas with defaults/transforms
   */
  protected abstract readonly inputSchema: z.ZodType<TInput, any, any>;

  /**
   * Constructor
   * @param client - ObsidianClient for hybrid vault operations (filesystem + API)
   * @param logger - Winston logger instance
   */
  constructor(
    protected readonly client: ObsidianClient,
    protected readonly logger: Logger
  ) {}

  /**
   * Execute the tool with input validation and error handling
   * This is the main entry point called by the MCP server
   *
   * @param rawInput - Raw input from the MCP client (unvalidated)
   * @returns Tool output
   * @throws ObsidianError on validation or execution failure
   */
  async execute(rawInput: unknown): Promise<TOutput> {
    this.logger.debug(`Executing tool: ${this.name}`, { input: rawInput });

    try {
      // 1. Validate and parse input
      const input = this.validateInput(rawInput);

      // 2. Execute the tool implementation
      const result = await this.run(input);

      // 3. Log success
      this.logger.info(`Tool ${this.name} completed successfully`);

      return result;
    } catch (error) {
      // 4. Handle and categorize errors
      this.logger.error(`Tool ${this.name} failed`, { error });
      throw this.handleError(error);
    }
  }

  /**
   * Tool implementation - must be overridden by subclasses
   *
   * @param input - Validated and typed input
   * @returns Tool output
   */
  protected abstract run(input: TInput): Promise<TOutput>;

  /**
   * Validate input using the Zod schema
   *
   * @param rawInput - Unvalidated input
   * @returns Validated and typed input
   * @throws ZodError if validation fails
   */
  private validateInput(rawInput: unknown): TInput {
    try {
      return this.inputSchema.parse(rawInput);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
        this.logger.warn(`Input validation failed for ${this.name}`, { errors: error.errors });
        throw new Error(`Invalid input for ${this.name}: ${messages}`);
      }
      throw error;
    }
  }

  /**
   * Handle and categorize errors
   *
   * @param error - Raw error from execution
   * @returns Categorized ObsidianError
   */
  protected handleError(error: unknown): ObsidianError {
    return categorizeError(error);
  }

  /**
   * Convert this tool to an MCP tool definition
   * Used by the MCP server to register the tool
   *
   * @returns MCP-compatible tool definition
   */
  toMCPTool(): MCPToolDefinition {
    const jsonSchema = zodToJsonSchema(this.inputSchema, {
      name: `${this.name}_input`,
      $refStrategy: 'none', // Inline all schemas instead of using $ref
    });

    // Extract the schema properties (zodToJsonSchema wraps it)
    const schema = 'definitions' in jsonSchema
      ? jsonSchema.definitions?.[`${this.name}_input`] ?? jsonSchema
      : jsonSchema;

    return {
      name: this.name,
      description: this.description,
      inputSchema: schema as MCPToolDefinition['inputSchema'],
    };
  }
}
