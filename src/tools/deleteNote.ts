import { z } from 'zod';
import { BaseTool } from './base.js';
import type { DeleteNoteResult } from '../types/obsidian.js';

const DeleteNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  confirm: z.literal(true, {
    errorMap: () => ({ message: 'confirm must be true to delete a note. This is a safety guard to prevent accidental deletion.' }),
  }),
});

type DeleteNoteInput = z.infer<typeof DeleteNoteInputSchema>;

/**
 * DeleteNoteTool - Delete a note from the Obsidian vault
 *
 * Safety guards:
 * - Requires `confirm: true` parameter
 * - Respects ENABLE_DELETE environment variable
 */
export class DeleteNoteTool extends BaseTool<DeleteNoteInput, DeleteNoteResult> {
  readonly name = 'delete_note';
  readonly description =
    'Delete a note from the Obsidian vault. Requires confirm: true as a safety guard. ' +
    'Can be disabled entirely via ENABLE_DELETE=false environment variable.';
  protected readonly inputSchema = DeleteNoteInputSchema;

  protected async run(input: DeleteNoteInput): Promise<DeleteNoteResult> {
    this.logger.debug(`Deleting note: ${input.path}`);
    return await this.client.deleteFile(input.path);
  }
}
