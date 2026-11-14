import { z } from 'zod';
import { BaseTool } from './base.js';
import type { ListNotesResult, NoteMetadata } from '../types/obsidian.js';
import { readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { minimatch } from 'minimatch';

/**
 * Input schema for list_notes tool
 */
const ListNotesInputSchema = z.object({
  folder: z.string().optional(),
  recursive: z.boolean().optional().default(true),
  pattern: z.string().optional(),
  sortBy: z.enum(['name', 'modified', 'created', 'size']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().positive().optional(),
  dateRange: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
    })
    .strict()
    .optional(),
});

type ListNotesInput = z.output<typeof ListNotesInputSchema>;

/**
 * ListNotesTool - List and filter notes in the Obsidian vault
 *
 * This tool provides comprehensive note listing and filtering capabilities,
 * including pattern matching, sorting, and date range filtering.
 *
 * Features:
 * - List all notes or notes in a specific folder
 * - Recursive or non-recursive listing
 * - Glob pattern matching (e.g., "*.md", "2025-*.md")
 * - Sort by name, modified date, created date, or size
 * - Limit number of results
 * - Filter by date range (useful for daily notes)
 *
 * Example usage:
 * ```json
 * {
 *   "folder": "Daily Notes",
 *   "pattern": "2025-*.md",
 *   "sortBy": "modified",
 *   "order": "desc",
 *   "limit": 10
 * }
 * ```
 */
export class ListNotesTool extends BaseTool<ListNotesInput, ListNotesResult> {
  readonly name = 'list_notes';
  readonly description =
    'List notes in the Obsidian vault with optional filtering, sorting, and pattern matching. ' +
    'Supports recursive listing, glob patterns, date range filtering, sorting, and pagination (offset + limit).';
  protected readonly inputSchema = ListNotesInputSchema;

  /**
   * Execute the list operation
   *
   * @param input - Validated input with filtering and sorting options
   * @returns List of notes with metadata
   */
  protected async run(input: ListNotesInput): Promise<ListNotesResult> {
    this.logger.debug('Listing notes', {
      folder: input.folder,
      recursive: input.recursive,
      pattern: input.pattern,
      sortBy: input.sortBy,
      order: input.order,
      limit: input.limit,
    });

    // Get the vault path
    const vaultPath = this.client['config'].vaultPath;
    const targetFolder = this.client.resolveSafePath(input.folder);

    // Collect all matching notes
    const notes: NoteMetadata[] = [];
    await this.collectNotes(targetFolder, vaultPath, input, notes);

    this.logger.debug(`Found ${notes.length} notes before filtering`);

    // Apply date range filter if specified
    let filtered = notes;
    if (input.dateRange && (input.dateRange.start || input.dateRange.end)) {
      filtered = this.filterByDateRange(notes, input.dateRange.start, input.dateRange.end);
      this.logger.debug(`Filtered to ${filtered.length} notes by date range`);
    }

    // Sort notes
    const sorted = this.sortNotes(filtered, input.sortBy, input.order);

    // Apply offset and limit
    const offset = input.offset ?? 0;
    const sliced = offset > 0 ? sorted.slice(offset) : sorted;
    const limited = input.limit ? sliced.slice(0, input.limit) : sliced;

    return {
      notes: limited,
      total: notes.length,
      filtered: filtered.length,
    };
  }

  /**
   * Recursively collect notes from a directory
   */
  private async collectNotes(
    dirPath: string,
    vaultPath: string,
    input: ListNotesInput,
    notes: NoteMetadata[]
  ): Promise<void> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        const relativePath = relative(vaultPath, fullPath);

        if (entry.isDirectory()) {
          // Skip .obsidian and other hidden directories
          if (entry.name.startsWith('.')) {
            continue;
          }

          // Recurse if recursive mode is enabled
          if (input.recursive) {
            await this.collectNotes(fullPath, vaultPath, input, notes);
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Check if file matches pattern
          if (input.pattern && !minimatch(relativePath, input.pattern)) {
            continue;
          }

          // Get file stats
          const stats = await stat(fullPath);

          notes.push({
            path: relativePath.replace(/\\/g, '/'), // Normalize path separators
            size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          });
        }
      }
    } catch (error) {
      // If directory doesn't exist or can't be read, handle gracefully
      const { createError } = await import('../obsidian/errorHandler.js');
      const { ObsidianErrorType } = await import('../types/obsidian.js');

      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw createError(
          ObsidianErrorType.FILE_NOT_FOUND,
          `Folder not found: ${relative(vaultPath, dirPath)}`,
          { path: relative(vaultPath, dirPath) }
        );
      }

      throw createError(ObsidianErrorType.IO_ERROR, `Failed to list notes: ${error}`, {
        path: relative(vaultPath, dirPath),
      });
    }
  }

  /**
   * Filter notes by date range
   * Extracts date from filename (YYYY-MM-DD pattern) and compares
   */
  private filterByDateRange(
    notes: NoteMetadata[],
    startDate?: string,
    endDate?: string
  ): NoteMetadata[] {
    return notes.filter((note) => {
      // Extract date from filename (YYYY-MM-DD pattern)
      const dateMatch = note.path.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch || !dateMatch[1]) {
        return false; // No date found in filename
      }

      const noteDate = dateMatch[1];

      // Check start date
      if (startDate && noteDate < startDate) {
        return false;
      }

      // Check end date
      if (endDate && noteDate > endDate) {
        return false;
      }

      return true;
    });
  }

  /**
   * Sort notes by specified field and order
   */
  private sortNotes(
    notes: NoteMetadata[],
    sortBy: 'name' | 'modified' | 'created' | 'size',
    order: 'asc' | 'desc'
  ): NoteMetadata[] {
    const sorted = [...notes].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.path.localeCompare(b.path);
          break;
        case 'modified':
          comparison = a.modified.localeCompare(b.modified);
          break;
        case 'created':
          comparison = a.created.localeCompare(b.created);
          break;
        case 'size':
          comparison = a.size - b.size;
          break;
      }

      return order === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }
}
