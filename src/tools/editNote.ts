import { z } from 'zod';
import { BaseTool } from './base.js';
import { createError } from '../obsidian/errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import type { EditNoteResult } from '../types/obsidian.js';
import { countOccurrences, restoreEol, toLF } from '../utils/markdown.js';
import { withFileLock } from '../utils/fileLock.js';

const EditSchema = z.object({
  oldText: z.string().min(1, 'oldText must not be empty').describe('Exact text to find (whitespace and case must match)'),
  newText: z.string().describe('Replacement text (empty string deletes oldText)'),
  replaceAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace every occurrence. If false, oldText must occur exactly once.'),
});

const EditNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  edits: z
    .array(EditSchema)
    .min(1, 'At least one edit is required')
    .max(100)
    .describe('Applied in order; each edit sees the result of the previous one. All-or-nothing.'),
});

type EditNoteInput = z.output<typeof EditNoteInputSchema>;

/**
 * EditNoteTool - exact find-and-replace edits inside a note
 *
 * Lets a client change part of a note (tick a checkbox, fix a sentence) without
 * rewriting the whole file. Edits are validated before anything is written: if
 * any edit's oldText is missing or ambiguous, the note is left untouched.
 *
 * Line endings: matching is done on LF-normalized text and the note's original
 * line ending (LF or CRLF) is restored on write.
 *
 * Example:
 * ```json
 * { "path": "Lists/Shopping.md",
 *   "edits": [{ "oldText": "- [ ] eggs", "newText": "- [x] eggs" }] }
 * ```
 */
export class EditNoteTool extends BaseTool<EditNoteInput, EditNoteResult> {
  readonly name = 'edit_note';
  readonly description =
    'Edit part of an existing note by exact find-and-replace, without rewriting the whole file. ' +
    'Pass one or more edits {oldText, newText}; each oldText must match exactly once (include surrounding text to ' +
    'make it unique) unless replaceAll is true. Edits apply in order and are all-or-nothing: if any edit fails, ' +
    'the note is unchanged. Prefer this over write_note for small changes like checking off a list item.';
  protected readonly inputSchema = EditNoteInputSchema;

  protected async run(input: EditNoteInput): Promise<EditNoteResult> {
    return withFileLock(input.path, () => this.apply(input));
  }

  private async apply(input: EditNoteInput): Promise<EditNoteResult> {
    const { content: original } = await this.client.readFile(input.path);
    const { text, eol } = toLF(original);

    let working = text;
    let replacements = 0;

    input.edits.forEach((edit, i) => {
      const oldText = toLF(edit.oldText).text;
      const newText = toLF(edit.newText).text;
      const count = countOccurrences(working, oldText);
      const label = input.edits.length > 1 ? `Edit ${i + 1}: ` : '';

      if (count === 0) {
        throw createError(ObsidianErrorType.EDIT_FAILED, `${label}oldText not found in ${input.path}`, {
          path: input.path,
          suggestedAction:
            'Read the note first and copy oldText exactly, including whitespace, punctuation and list markers. ' +
            'No changes were written.',
        });
      }
      if (count > 1 && !edit.replaceAll) {
        throw createError(
          ObsidianErrorType.EDIT_FAILED,
          `${label}oldText occurs ${count} times in ${input.path}; expected exactly 1`,
          {
            path: input.path,
            suggestedAction:
              'Include more surrounding text so oldText is unique, or set replaceAll: true. No changes were written.',
          }
        );
      }

      working = edit.replaceAll ? working.split(oldText).join(newText) : working.replace(oldText, () => newText);
      replacements += count;
    });

    const output = restoreEol(working, eol);
    if (output !== original) {
      await this.client.writeFile(input.path, output, false);
    }

    this.logger.info('Note edited', { path: input.path, edits: input.edits.length, replacements });

    return { success: true, path: input.path, replacements, newLength: output.length };
  }
}
