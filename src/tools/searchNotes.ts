import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { SearchNotesResult, SearchMatch } from '../types/obsidian.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ListNotesTool } from './listNotes.js';
import { createError } from '../obsidian/errorHandler.js';
import { ObsidianErrorType } from '../types/obsidian.js';
import { frontmatterMatches, noteHasTags, parseNote } from '../utils/tags.js';

/**
 * Input schema for search_notes tool
 */
const SearchNotesInputSchema = z
  .object({
    query: z
      .string()
      .optional()
      .describe('Text (or regex with useRegex) to find. Omit to just filter notes by tags/frontmatter.'),
    folder: z.string().optional(),
    tags: z
      .array(z.string().min(1))
      .optional()
      .describe('Only notes with these tags (frontmatter or inline). "recipe" also matches "recipe/dinner".'),
    tagMatch: z.enum(['all', 'any']).optional().default('all'),
    frontmatter: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Only notes whose frontmatter matches, e.g. {"status": "draft"}. Strings compare case-insensitively; ' +
          'list fields match if they contain the value; an array value requires all items; null means the key is absent.'
      ),
    caseSensitive: z.boolean().optional().default(false),
    useRegex: z.boolean().optional().default(false),
    includeContent: z.boolean().optional().default(true),
    contextLines: z.number().int().min(0).optional().default(1),
    includeFrontmatter: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include each matching note\'s frontmatter in the results'),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe('Max matching lines to return (or max notes when no query). Default 50; check truncated.'),
  })
  .refine((v) => (v.query !== undefined && v.query.length > 0) || v.tags?.length || v.frontmatter, {
    message: 'Provide a query, tags, or frontmatter filter',
    path: ['query'],
  });

type SearchNotesInput = z.output<typeof SearchNotesInputSchema>;
type ResultEntry = SearchNotesResult['results'][number];

/**
 * SearchNotesTool - Full-text and metadata search across notes
 *
 * - Text or regex search with line numbers and context
 * - Filter by tags (frontmatter + inline, nested-tag aware) and frontmatter fields
 * - Filter-only mode (no query) returns matching notes
 */
export class SearchNotesTool extends BaseTool<SearchNotesInput, SearchNotesResult> {
  readonly name = 'search_notes';
  readonly description =
    'Search notes by text and/or metadata. Text search supports regex, case sensitivity and context lines. ' +
    'Filter by tags (frontmatter or inline; parent tags match nested ones) and frontmatter fields, e.g. ' +
    '{tags: ["recipe"], frontmatter: {course: "dinner"}, query: "chicken"}. Omit query to just list notes matching the ' +
    'filters. Results are capped by limit (default 50); truncated tells you if more exist.';
  protected readonly inputSchema = SearchNotesInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Search notes', readOnlyHint: true };

  protected async run(input: SearchNotesInput): Promise<SearchNotesResult> {
    const listResult = await new ListNotesTool(this.client, this.logger).execute({
      folder: input.folder,
      recursive: true,
      limit: Number.MAX_SAFE_INTEGER,
    });

    const pattern = input.query ? this.buildPattern(input) : null;
    const filtering = Boolean(input.tags?.length || input.frontmatter);
    const vaultPath = this.client['config'].vaultPath;

    const results: ResultEntry[] = [];
    let totalMatches = 0;
    let returned = 0;
    let matchedFiles = 0;
    let truncated = false;

    for (const note of listResult.notes) {
      let content: string;
      try {
        content = await readFile(join(vaultPath, note.path), 'utf-8');
      } catch (error) {
        this.logger.warn(`Failed to search note: ${note.path}`, { error });
        continue;
      }

      let frontmatter: Record<string, unknown> | undefined;
      if (filtering || input.includeFrontmatter) {
        const parsed = parseNote(content);
        if (input.tags?.length && !noteHasTags(parsed.tags, input.tags, input.tagMatch)) continue;
        if (input.frontmatter && !frontmatterMatches(parsed.frontmatter, input.frontmatter)) continue;
        frontmatter = parsed.frontmatter;
      }
      matchedFiles++;

      const entry: ResultEntry = { path: note.path, matches: [], matchCount: 0 };
      if (input.includeFrontmatter && frontmatter) entry.frontmatter = frontmatter;

      if (!pattern) {
        // Filter-only mode: limit counts notes
        totalMatches++;
        if (returned < input.limit) {
          results.push(entry);
          returned++;
        } else {
          truncated = true;
        }
        continue;
      }

      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!pattern.test(line)) continue;

        entry.matchCount++;
        totalMatches++;
        if (returned >= input.limit) {
          truncated = true;
          continue;
        }

        const match: SearchMatch = { line: i + 1, content: input.includeContent ? line : '' };
        if (input.includeContent && input.contextLines > 0) {
          match.context = {
            before: lines.slice(Math.max(0, i - input.contextLines), i),
            after: lines.slice(i + 1, i + 1 + input.contextLines),
          };
        }
        entry.matches.push(match);
        returned++;
      }

      if (entry.matches.length > 0) {
        // matchCount reports what was returned for this note; totalMatches has the full count
        entry.matchCount = entry.matches.length;
        results.push(entry);
      }
    }

    this.logger.debug(`search_notes: ${totalMatches} matches in ${matchedFiles} notes (returned ${returned})`);

    return {
      results,
      totalMatches,
      searchedFiles: listResult.notes.length,
      ...(filtering ? { matchedFiles } : {}),
      truncated,
    };
  }

  private buildPattern(input: SearchNotesInput): RegExp {
    const flags = input.caseSensitive ? '' : 'i';
    try {
      const source = input.useRegex ? input.query! : input.query!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(source, flags);
    } catch (error) {
      throw createError(ObsidianErrorType.PARSE_ERROR, `Invalid regular expression pattern: ${input.query}`, {
        suggestedAction: 'Check the regex syntax. Set useRegex: false for literal text search.',
        originalError: error,
      });
    }
  }
}
