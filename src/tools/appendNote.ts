import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { AppendNoteResult } from '../types/obsidian.js';

/**
 * Input schema for append_note tool
 */
const AppendNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  separator: z.string().optional().default('\n\n'),
  timestamp: z.boolean().optional().default(false),
});

type AppendNoteInput = z.output<typeof AppendNoteInputSchema>;

/**
 * AppendNoteTool - Append content to existing notes
 *
 * This tool appends content to the end of an existing note, with optional
 * separators and timestamps.
 *
 * Features:
 * - Append to existing notes only (fails if note doesn't exist)
 * - Customizable separator (default: two newlines)
 * - Optional timestamp prefix
 * - Returns new file length
 *
 * Example usage:
 * ```json
 * {
 *   "path": "Daily Notes/2025-11-01.md",
 *   "content": "Completed MCP implementation",
 *   "separator": "\n\n",
 *   "timestamp": true
 * }
 * ```
 *
 * With timestamp: true, content becomes: "10:30 AM - Completed MCP implementation"
 */
export class AppendNoteTool extends BaseTool<AppendNoteInput, AppendNoteResult> {
  readonly name = 'append_note';
  readonly description =
    'Append content to the end of an existing note in the Obsidian vault. ' +
    'Optionally add a timestamp prefix. Note must already exist. ' +
    'Returns the new length of the file in bytes.';
  protected readonly inputSchema = AppendNoteInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Append to note', readOnlyHint: false, destructiveHint: false, idempotentHint: false };

  /**
   * Execute the append operation
   *
   * @param input - Validated input with path, content, and options
   * @returns Append result with new file length
   */
  protected async run(input: AppendNoteInput): Promise<AppendNoteResult> {
    this.logger.debug(`Appending to note: ${input.path}`, {
      contentLength: input.content.length,
      separator: input.separator,
      timestamp: input.timestamp,
    });

    // Prepare content with optional timestamp
    let content = input.content;
    if (input.timestamp) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      content = `${timeStr} - ${content}`;
    }

    return await this.client.appendFile(
      input.path,
      content,
      input.separator
    );
  }
}
