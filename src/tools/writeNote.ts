import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { WriteNoteResult } from '../types/obsidian.js';
import { withFileLock } from '../utils/fileLock.js';

/**
 * Input schema for write_note tool
 */
const WriteNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  content: z.string(),
  overwrite: z.boolean().optional().default(false),
  createDirs: z.boolean().optional().default(true),
});

type WriteNoteInput = z.output<typeof WriteNoteInputSchema>;

/**
 * WriteNoteTool - Create or overwrite notes in the Obsidian vault
 *
 * This tool writes content to a markdown file, with safety features to prevent
 * accidental overwrites.
 *
 * Features:
 * - Create new notes with content
 * - Optionally overwrite existing notes (requires explicit flag)
 * - Automatically create parent directories
 * - Validates file paths (prevents directory traversal)
 * - Enforces file size limits on write
 *
 * Safety:
 * - By default, will NOT overwrite existing files (overwrite: false)
 * - Validates all paths before writing
 * - Creates directories only if createDirs: true
 *
 * Example usage:
 * ```json
 * {
 *   "path": "Daily Notes/2025-11-01.md",
 *   "content": "# 2025-11-01\n\n## Work\n- Implemented write_note tool",
 *   "overwrite": false,
 *   "createDirs": true
 * }
 * ```
 */
export class WriteNoteTool extends BaseTool<WriteNoteInput, WriteNoteResult> {
  readonly name = 'write_note';
  readonly description =
    'Create or overwrite a note in the Obsidian vault. By default, will not overwrite existing files for safety. ' +
    'Automatically creates parent directories. Returns success status and whether the file was newly created.';
  protected readonly inputSchema = WriteNoteInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Write note', readOnlyHint: false, destructiveHint: true, idempotentHint: true };

  /**
   * Execute the write operation
   *
   * @param input - Validated input with path, content, and options
   * @returns Write result with success status and creation info
   */
  protected async run(input: WriteNoteInput): Promise<WriteNoteResult> {
    // Serialize with edit_note/update_section so an overwrite can't land mid-edit
    return withFileLock(input.path, () => this.write(input));
  }

  private async write(input: WriteNoteInput): Promise<WriteNoteResult> {
    this.logger.debug(`Writing note: ${input.path}`, {
      contentLength: input.content.length,
      overwrite: input.overwrite,
      createDirs: input.createDirs,
    });

    // Check if file exists when overwrite is false
    if (!input.overwrite) {
      try {
        // Try to read the file - if it succeeds, file exists
        await this.client.readFile(input.path);

        // File exists and overwrite is false - throw error
        const { createError } = await import('../obsidian/errorHandler.js');
        const { ObsidianErrorType } = await import('../types/obsidian.js');
        throw createError(
          ObsidianErrorType.PERMISSION_DENIED,
          `File already exists: ${input.path}. Set overwrite: true to replace it.`,
          {
            path: input.path,
            suggestedAction: 'Set overwrite: true in the request, or use a different filename.',
          }
        );
      } catch (error: any) {
        // If error is FILE_NOT_FOUND, that's good - file doesn't exist, we can create it
        if (error.type === 'FILE_NOT_FOUND') {
          // Continue to write
        } else {
          // Re-throw other errors (including our PERMISSION_DENIED)
          throw error;
        }
      }
    }

    return await this.client.writeFile(
      input.path,
      input.content,
      input.createDirs
    );
  }
}
