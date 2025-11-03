import { z } from 'zod';
import { BaseTool } from './base.js';
import type { ReadNoteResult } from '../types/obsidian.js';

/**
 * Input schema for read_note tool
 */
const ReadNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
});

type ReadNoteInput = z.infer<typeof ReadNoteInputSchema>;

/**
 * ReadNoteTool - Read the contents of a note from the Obsidian vault
 *
 * This tool reads a markdown file from the vault and returns its content
 * along with file metadata (size, timestamps).
 *
 * Features:
 * - Reads any markdown file in the vault
 * - Returns file statistics (size, created, modified dates)
 * - Validates file paths (prevents directory traversal)
 * - Enforces file size limits
 * - Handles nested directories
 *
 * Example usage:
 * ```json
 * {
 *   "path": "daily/2024-01-01.md"
 * }
 * ```
 */
export class ReadNoteTool extends BaseTool<ReadNoteInput, ReadNoteResult> {
  readonly name = 'read_note';
  readonly description = 'Read the contents of a note from the Obsidian vault. Returns the note content and file metadata (size, timestamps).';
  protected readonly inputSchema = ReadNoteInputSchema;

  /**
   * Execute the read operation
   *
   * @param input - Validated input with file path
   * @returns Note content and statistics
   */
  protected async run(input: ReadNoteInput): Promise<ReadNoteResult> {
    this.logger.debug(`Reading note: ${input.path}`);
    return await this.client.readFile(input.path);
  }
}
