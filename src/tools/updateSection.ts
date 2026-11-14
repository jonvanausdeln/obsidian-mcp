import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import { createError } from '../obsidian/errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import type { UpdateSectionResult } from '../types/obsidian.js';
import {
  findHeadings,
  matchHeadings,
  parseHeadingSelector,
  restoreEol,
  sectionRange,
  toLF,
  trimBlankLines,
  type Heading,
} from '../utils/markdown.js';
import { withFileLock } from '../utils/fileLock.js';

const UpdateSectionInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  heading: z
    .string()
    .min(1, 'Heading is required')
    .describe(
      'Heading text, matched case-insensitively. Optionally prefix #s to pin the level ("## Produce") ' +
        'or use "Parent > Child" to pick a nested heading.'
    ),
  content: z.string().describe('Markdown to write into the section (without the heading line itself)'),
  mode: z
    .enum(['replace', 'append', 'prepend'])
    .optional()
    .default('replace')
    .describe('replace the section content, append to its end, or prepend right after the heading'),
  includeSubsections: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'false (default): only touch the content directly under the heading, before any sub-heading. ' +
        'true: the section runs until the next heading of the same or higher level, sub-headings included.'
    ),
  createIfMissing: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'If the heading is not found, add it (at the end of the parent section for "Parent > Child", else end of note)'
    ),
  occurrence: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('1-based pick when several headings match. Without it, multiple matches are an error.'),
});

type UpdateSectionInput = z.output<typeof UpdateSectionInputSchema>;

/**
 * UpdateSectionTool - edit the content under a markdown heading
 *
 * Headings inside fenced code blocks and YAML frontmatter are ignored.
 * The note's line ending style (LF/CRLF) and trailing newline are preserved.
 */
export class UpdateSectionTool extends BaseTool<UpdateSectionInput, UpdateSectionResult> {
  readonly name = 'update_section';
  readonly description =
    'Replace, append to, or prepend to the content under a heading in an existing note, leaving the rest of the ' +
    'note untouched. By default only the content directly under the heading is affected (sub-headings are kept); ' +
    'set includeSubsections to cover the whole section. Use "Parent > Child" or "## Heading" to disambiguate. ' +
    'Good for updating a "## Tasks" or "## Produce" list without rewriting the note.';
  protected readonly inputSchema = UpdateSectionInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Update section', readOnlyHint: false, destructiveHint: true, idempotentHint: false };

  protected async run(input: UpdateSectionInput): Promise<UpdateSectionResult> {
    return withFileLock(input.path, () => this.apply(input));
  }

  private async apply(input: UpdateSectionInput): Promise<UpdateSectionResult> {
    const { content: original } = await this.client.readFile(input.path);
    const { text: lfText, eol } = toLF(original);

    const hadTrailingNewline = lfText.endsWith('\n');
    const lines = (hadTrailingNewline ? lfText.slice(0, -1) : lfText).split('\n');
    const headings = findHeadings(lines);
    const contentLines = toLF(input.content).text.replace(/\n$/, '').split('\n');

    const matches = matchHeadings(headings, lines.length, input.heading);

    let newLines: string[];
    let target: Heading;
    let created = false;

    if (matches.length === 0) {
      if (!input.createIfMissing) {
        const available = headings.map((h) => `${'#'.repeat(h.level)} ${h.text}`).slice(0, 30);
        throw createError(ObsidianErrorType.EDIT_FAILED, `Heading "${input.heading}" not found in ${input.path}`, {
          path: input.path,
          suggestedAction:
            (available.length ? `Headings in this note: ${available.join(' | ')}. ` : 'This note has no headings. ') +
            'Set createIfMissing: true to add it.',
        });
      }
      ({ lines: newLines, heading: target } = this.insertHeading(lines, headings, input, contentLines));
      created = true;
    } else {
      if (matches.length > 1 && input.occurrence === undefined) {
        const where = matches.map((idx) => `line ${headings[idx]!.line + 1}`).join(', ');
        throw createError(
          ObsidianErrorType.EDIT_FAILED,
          `Heading "${input.heading}" matches ${matches.length} headings (${where})`,
          {
            path: input.path,
            suggestedAction: 'Use "Parent > Child", add #s for the level, or pass occurrence (1-based).',
          }
        );
      }
      const pick = input.occurrence ?? 1;
      if (pick > matches.length) {
        throw createError(
          ObsidianErrorType.EDIT_FAILED,
          `occurrence ${pick} requested but only ${matches.length} matching heading(s) found`,
          { path: input.path }
        );
      }
      const index = matches[pick - 1]!;
      target = headings[index]!;
      newLines = this.rewriteSection(lines, headings, index, input, contentLines);
    }

    const output = restoreEol(newLines.join('\n') + (hadTrailingNewline || created ? '\n' : ''), eol);
    if (output !== original) {
      await this.client.writeFile(input.path, output, false);
    }

    this.logger.info('Section updated', { path: input.path, heading: target.text, mode: input.mode, created });

    return {
      success: true,
      path: input.path,
      heading: target.text,
      headingLevel: target.level,
      sectionFound: !created,
      created,
      mode: input.mode,
      newLength: output.length,
    };
  }

  /**
   * Rewrite the body of an existing heading
   */
  private rewriteSection(
    lines: string[],
    headings: Heading[],
    index: number,
    input: UpdateSectionInput,
    contentLines: string[]
  ): string[] {
    const heading = headings[index]!;
    const bodyStart = heading.line + 1;
    const end = input.includeSubsections
      ? sectionRange(headings, index, lines.length).end
      : (headings[index + 1]?.line ?? lines.length);

    const bodyLines = lines.slice(bodyStart, end);
    const existing = trimBlankLines(bodyLines);
    const incoming = trimBlankLines(contentLines);
    // Keep the note's style for a blank line right after the heading
    const leadingBlank = bodyLines.length > 0 && bodyLines[0]!.trim() === '' && existing.length > 0;

    let body: string[];
    switch (input.mode) {
      case 'append':
        body = [...existing, ...incoming];
        break;
      case 'prepend':
        body = [...incoming, ...existing];
        break;
      default:
        body = incoming;
    }

    const after = lines.slice(end);
    const block = body.length ? [...(leadingBlank ? [''] : []), ...body] : [];
    // One blank line between the section body and whatever follows
    const separator = after.length > 0 && block.length > 0 ? [''] : [];

    return [...lines.slice(0, bodyStart), ...block, ...separator, ...after];
  }

  /**
   * Add a missing heading (and its content) at the end of the parent section or the note
   */
  private insertHeading(
    lines: string[],
    headings: Heading[],
    input: UpdateSectionInput,
    contentLines: string[]
  ): { lines: string[]; heading: Heading } {
    const parts = parseHeadingSelector(input.heading);
    const last = parts[parts.length - 1]!;
    let insertAt = lines.length;
    let level = last.level ?? 2;

    if (parts.length > 1) {
      const parentSelector = input.heading.slice(0, input.heading.lastIndexOf('>'));
      const parents = matchHeadings(headings, lines.length, parentSelector);
      if (parents.length !== 1) {
        throw createError(
          ObsidianErrorType.EDIT_FAILED,
          parents.length === 0
            ? `Parent heading "${parentSelector.trim()}" not found in ${input.path}`
            : `Parent heading "${parentSelector.trim()}" is ambiguous (${parents.length} matches)`,
          { path: input.path, suggestedAction: 'Create or disambiguate the parent heading first.' }
        );
      }
      const parentRange = sectionRange(headings, parents[0]!, lines.length);
      insertAt = parentRange.end;
      level = last.level ?? Math.min(parentRange.heading.level + 1, 6);
    }

    const before = lines.slice(0, insertAt);
    while (before.length > 0 && before[before.length - 1]!.trim() === '') before.pop();
    const after = lines.slice(insertAt);

    const headingLine = `${'#'.repeat(level)} ${last.text}`;
    const incoming = trimBlankLines(contentLines);
    const block = [
      ...(before.length ? [''] : []),
      headingLine,
      ...incoming,
      ...(after.length ? [''] : []),
    ];

    return {
      lines: [...before, ...block, ...after],
      heading: { line: before.length + (before.length ? 1 : 0), level, text: last.text },
    };
  }
}
