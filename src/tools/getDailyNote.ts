import { z } from 'zod';
import { BaseTool } from './base.js';
import { normalizeDateParam } from '../utils/dateUtils.js';
import type { GetDailyNoteResult } from '../types/obsidian.js';

/**
 * Input schema for get_daily_note tool
 */
const GetDailyNoteInputSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional()
    .describe('ISO date string (YYYY-MM-DD). Defaults to today if not provided.'),
});

type GetDailyNoteInput = z.infer<typeof GetDailyNoteInputSchema>;

/**
 * GetDailyNoteTool - Get or locate the daily note for a specific date
 *
 * This tool retrieves the daily note for a given date using a hybrid approach:
 * - First tries the Obsidian REST API (if configured) to get the exact daily note path
 * - Falls back to filesystem using standard pattern: Daily Notes/YYYY-MM-DD.md
 *
 * Features:
 * - API-first with filesystem fallback for reliability
 * - Returns whether the note exists and its content if available
 * - Handles missing dates (defaults to today)
 * - Works with Obsidian's daily notes and periodic notes plugins
 * - Respects user's configured daily note format when using API
 *
 * Example usage:
 * ```json
 * {
 *   "date": "2025-11-01"
 * }
 * ```
 *
 * Returns the daily note path, existence status, content (if exists), and which
 * source was used (api or filesystem).
 */
export class GetDailyNoteTool extends BaseTool<GetDailyNoteInput, GetDailyNoteResult> {
  readonly name = 'get_daily_note';
  readonly description =
    'Get or locate the daily note for a specific date. Returns the note path, whether it exists, and its content. Uses API-first approach with filesystem fallback. Date format: YYYY-MM-DD (defaults to today).';
  protected readonly inputSchema = GetDailyNoteInputSchema;

  /**
   * Execute the get daily note operation
   *
   * @param input - Validated input with optional date
   * @returns Daily note info including path, existence, content, and source
   */
  protected async run(input: GetDailyNoteInput): Promise<GetDailyNoteResult> {
    // Normalize date parameter (default to today)
    const date = normalizeDateParam(input.date);

    this.logger.debug(`Getting daily note for date: ${date}`);

    // Use hybrid client which handles API-first with filesystem fallback
    const result = await this.client.getDailyNote(date);

    this.logger.info('Daily note retrieved', {
      date,
      path: result.path,
      exists: result.exists,
      source: result.source,
    });

    return result;
  }
}
