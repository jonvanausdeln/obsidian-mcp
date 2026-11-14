import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import { createError } from '../obsidian/errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import type { FileStats } from '../types/obsidian.js';
import { findHeadings, matchHeadings, sectionRange, toLF } from '../utils/markdown.js';

/**
 * Input schema for read_note tool
 */
const ReadNoteInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  heading: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Return only this section (heading line included). Same selector syntax as update_section: ' +
        '"Produce", "## Produce", or "Groceries > Produce".'
    ),
  occurrence: z.number().int().positive().optional().describe('1-based pick when several headings match'),
  includeSubsections: z
    .boolean()
    .optional()
    .default(true)
    .describe('With heading: include nested sub-headings (default true) or stop at the first sub-heading'),
  outline: z
    .boolean()
    .optional()
    .default(false)
    .describe('Also return the note\'s headings as [{level, text, line}]'),
  includeContent: z
    .boolean()
    .optional()
    .default(true)
    .describe('Set false with outline: true to get just the headings of a long note'),
});

type ReadNoteInput = z.output<typeof ReadNoteInputSchema>;

export interface ReadNoteToolResult {
  /** Full note, or the requested section. Omitted when includeContent is false. */
  content?: string;
  stats: FileStats;
  section?: { heading: string; level: number; startLine: number; endLine: number };
  outline?: Array<{ level: number; text: string; line: number }>;
}

/**
 * ReadNoteTool - Read a note, a single section of it, and/or its outline
 *
 * Reading one section or the outline keeps long notes (drafts, scripts,
 * daily logs) from filling the client's context.
 */
export class ReadNoteTool extends BaseTool<ReadNoteInput, ReadNoteToolResult> {
  readonly name = 'read_note';
  readonly description =
    'Read a note from the Obsidian vault with its file metadata. For long notes, pass heading to read just one ' +
    'section, or outline: true (optionally with includeContent: false) to see the headings first. ' +
    'Line numbers are 1-based.';
  protected readonly inputSchema = ReadNoteInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Read note', readOnlyHint: true };

  protected async run(input: ReadNoteInput): Promise<ReadNoteToolResult> {
    const { content, stats } = await this.client.readFile(input.path);

    // Fast path: plain read
    if (!input.heading && !input.outline) {
      return input.includeContent ? { content, stats } : { stats };
    }

    const lines = toLF(content).text.split('\n');
    const headings = findHeadings(lines);
    const result: ReadNoteToolResult = { stats };

    if (input.outline) {
      result.outline = headings.map((h) => ({ level: h.level, text: h.text, line: h.line + 1 }));
    }

    if (!input.heading) {
      if (input.includeContent) result.content = content;
      return result;
    }

    const matches = matchHeadings(headings, lines.length, input.heading);
    const available = () =>
      headings
        .slice(0, 30)
        .map((h) => `${'#'.repeat(h.level)} ${h.text}`)
        .join(' | ') || '(no headings)';

    if (matches.length === 0) {
      throw createError(ObsidianErrorType.SECTION_NOT_FOUND, `Heading "${input.heading}" not found in ${input.path}`, {
        path: input.path,
        suggestedAction: `Headings in this note: ${available()}`,
      });
    }
    if (matches.length > 1 && input.occurrence === undefined) {
      const where = matches.map((idx) => `line ${headings[idx]!.line + 1}`).join(', ');
      throw createError(
        ObsidianErrorType.AMBIGUOUS_HEADING,
        `Heading "${input.heading}" matches ${matches.length} headings (${where})`,
        { path: input.path, suggestedAction: 'Use "Parent > Child", add #s for the level, or pass occurrence (1-based).' }
      );
    }
    const pick = input.occurrence ?? 1;
    if (pick > matches.length) {
      throw createError(
        ObsidianErrorType.AMBIGUOUS_HEADING,
        `occurrence ${pick} requested but only ${matches.length} matching heading(s) found`,
        { path: input.path }
      );
    }

    const index = matches[pick - 1]!;
    const heading = headings[index]!;
    let end = input.includeSubsections
      ? sectionRange(headings, index, lines.length).end
      : (headings[index + 1]?.line ?? lines.length);
    // Drop trailing blank lines from the section
    while (end > heading.line + 1 && lines[end - 1]!.trim() === '') end--;

    result.section = { heading: heading.text, level: heading.level, startLine: heading.line + 1, endLine: end };
    if (input.includeContent) result.content = lines.slice(heading.line, end).join('\n');
    return result;
  }
}
