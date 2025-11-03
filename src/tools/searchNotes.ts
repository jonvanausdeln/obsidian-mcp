import { z } from 'zod';
import { BaseTool } from './base.js';
import type { SearchNotesResult, SearchMatch } from '../types/obsidian.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ListNotesTool } from './listNotes.js';

/**
 * Input schema for search_notes tool
 */
const SearchNotesInputSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  folder: z.string().optional(),
  caseSensitive: z.boolean().optional().default(false),
  useRegex: z.boolean().optional().default(false),
  includeContent: z.boolean().optional().default(true),
  contextLines: z.number().int().min(0).optional().default(2),
  limit: z.number().int().positive().optional(),
});

type SearchNotesInput = z.output<typeof SearchNotesInputSchema>;

/**
 * SearchNotesTool - Full-text search across notes in the Obsidian vault
 *
 * This tool provides comprehensive text search capabilities with support
 * for regular expressions, case sensitivity, and context line extraction.
 *
 * Features:
 * - Full-text search across all notes or specific folder
 * - Case-sensitive or case-insensitive search
 * - Regular expression pattern matching
 * - Extract context lines around matches
 * - Limit number of results
 * - Return match locations (line numbers)
 *
 * Example usage:
 * ```json
 * {
 *   "query": "TODO",
 *   "folder": "Work",
 *   "caseSensitive": false,
 *   "includeContent": true,
 *   "contextLines": 2,
 *   "limit": 10
 * }
 * ```
 */
export class SearchNotesTool extends BaseTool<SearchNotesInput, SearchNotesResult> {
  readonly name = 'search_notes';
  readonly description =
    'Search for text across notes in the Obsidian vault. Supports case-sensitive/insensitive search, ' +
    'regular expressions, context line extraction, and filtering by folder. Returns matches with line numbers and surrounding context.';
  protected readonly inputSchema = SearchNotesInputSchema;

  /**
   * Execute the search operation
   *
   * @param input - Validated input with search query and options
   * @returns Search results with matches and context
   */
  protected async run(input: SearchNotesInput): Promise<SearchNotesResult> {
    this.logger.debug('Searching notes', {
      query: input.query,
      folder: input.folder,
      caseSensitive: input.caseSensitive,
      useRegex: input.useRegex,
      limit: input.limit,
    });

    // Get list of notes to search
    const listTool = new ListNotesTool(this.client, this.logger);
    const listResult = await listTool.execute({
      folder: input.folder,
      recursive: true,
    });

    this.logger.debug(`Searching ${listResult.notes.length} notes`);

    // Prepare search pattern
    let searchPattern: RegExp;
    try {
      if (input.useRegex) {
        searchPattern = new RegExp(input.query, input.caseSensitive ? 'g' : 'gi');
      } else {
        // Escape special regex characters for literal search
        const escaped = input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchPattern = new RegExp(escaped, input.caseSensitive ? 'g' : 'gi');
      }
    } catch (error) {
      // Invalid regex pattern
      const { createError } = await import('../obsidian/errorHandler.js');
      const { ObsidianErrorType } = await import('../types/obsidian.js');
      throw createError(
        ObsidianErrorType.PARSE_ERROR,
        `Invalid regular expression pattern: ${input.query}`,
        {
          suggestedAction: 'Check the regex syntax. Set useRegex: false for literal text search.',
          originalError: error,
        }
      );
    }

    // Search each note
    const results: Array<{ path: string; matches: SearchMatch[] }> = [];
    const vaultPath = this.client['config'].vaultPath;

    for (const note of listResult.notes) {
      try {
        const fullPath = join(vaultPath, note.path);
        const content = await readFile(fullPath, 'utf-8');
        const lines = content.split('\n');

        const noteMatches: SearchMatch[] = [];

        // Search each line
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue; // Skip undefined lines

          if (searchPattern.test(line)) {
            const match: SearchMatch = {
              path: note.path,
              line: i + 1, // 1-based line numbers
              content: input.includeContent ? line : '',
            };

            // Add context lines if requested
            if (input.includeContent && input.contextLines > 0) {
              const beforeStart = Math.max(0, i - input.contextLines);
              const afterEnd = Math.min(lines.length - 1, i + input.contextLines);

              match.context = {
                before: lines.slice(beforeStart, i),
                after: lines.slice(i + 1, afterEnd + 1),
              };
            }

            noteMatches.push(match);

            // Reset regex lastIndex to avoid skipping matches
            searchPattern.lastIndex = 0;
          }
        }

        if (noteMatches.length > 0) {
          results.push({
            path: note.path,
            matches: noteMatches,
          });
        }
      } catch (error) {
        // Skip notes that can't be read (permissions, encoding issues, etc.)
        this.logger.warn(`Failed to search note: ${note.path}`, { error });
        continue;
      }
    }

    // Flatten matches and apply limit
    const allMatches = results.flatMap((r) => r.matches);
    const limitedMatches = input.limit ? allMatches.slice(0, input.limit) : allMatches;

    this.logger.debug(
      `Found ${allMatches.length} matches in ${results.length} notes (returned ${limitedMatches.length})`
    );

    return {
      results: this.groupMatchesByFile(limitedMatches),
      totalMatches: allMatches.length,
      searchedFiles: listResult.notes.length,
    };
  }

  /**
   * Group matches by file path
   */
  private groupMatchesByFile(
    matches: SearchMatch[]
  ): Array<{ path: string; matches: SearchMatch[]; matchCount: number }> {
    const grouped = new Map<string, SearchMatch[]>();

    for (const match of matches) {
      if (!grouped.has(match.path)) {
        grouped.set(match.path, []);
      }
      grouped.get(match.path)!.push(match);
    }

    return Array.from(grouped.entries()).map(([path, matches]) => ({
      path,
      matches,
      matchCount: matches.length,
    }));
  }
}
