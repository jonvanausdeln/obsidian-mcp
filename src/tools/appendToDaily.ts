import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import { normalizeDateParam } from '../utils/dateUtils.js';
import type { AppendToDailyResult } from '../types/obsidian.js';

/**
 * Input schema for append_to_daily tool
 */
const AppendToDailyInputSchema = z.object({
  content: z.string().min(1, 'Content is required and cannot be empty'),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional()
    .describe('ISO date string (YYYY-MM-DD). Defaults to today if not provided.'),
  separator: z
    .string()
    .optional()
    .default('\n')
    .describe('Separator to use before appended content. Defaults to newline.'),
  timestamp: z
    .boolean()
    .optional()
    .default(false)
    .describe('Whether to prefix content with current time (e.g., "2:30 PM - content").'),
  createIfMissing: z
    .boolean()
    .optional()
    .default(true)
    .describe('Create the daily note if it doesn\'t exist.'),
});

type AppendToDailyInput = z.infer<typeof AppendToDailyInputSchema>;

/**
 * AppendToDailyTool - Append content to a daily note
 *
 * This tool appends content to the daily note for a given date using a hybrid approach:
 * - First tries the Obsidian REST API (if configured) for real-time plugin integration
 * - Falls back to filesystem for reliability
 *
 * Features:
 * - API-first with filesystem fallback
 * - Optional timestamp prefix (e.g., "2:30 PM - your content")
 * - Creates daily note if missing (with formatted heading)
 * - Customizable separator (default: newline)
 * - Works seamlessly with Tasks plugin when using API
 *
 * Example usage:
 * ```json
 * {
 *   "content": "- [ ] Review pull requests",
 *   "date": "2025-11-01",
 *   "timestamp": true,
 *   "createIfMissing": true
 * }
 * ```
 *
 * Perfect for:
 * - Quick task capture
 * - Journal entries throughout the day
 * - Meeting notes
 * - Time-stamped log entries
 */
export class AppendToDailyTool extends BaseTool<AppendToDailyInput, AppendToDailyResult> {
  readonly name = 'append_to_daily';
  readonly description =
    'Append content to a daily note. Optionally adds timestamp prefix. Creates note if missing. Uses API-first approach with filesystem fallback for plugin integration. Date format: YYYY-MM-DD (defaults to today).';
  protected readonly inputSchema = AppendToDailyInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Append to daily note', readOnlyHint: false, destructiveHint: false, idempotentHint: false };

  /**
   * Execute the append to daily operation
   *
   * @param input - Validated input with content, optional date, separator, timestamp flag
   * @returns Result with success status, path, new length, and source
   */
  protected async run(input: AppendToDailyInput): Promise<AppendToDailyResult> {
    // Normalize date parameter (default to today)
    const date = normalizeDateParam(input.date);

    this.logger.debug('Appending to daily note', {
      date,
      contentLength: input.content.length,
      timestamp: input.timestamp,
      createIfMissing: input.createIfMissing,
    });

    // Use hybrid client which handles API-first with filesystem fallback
    const result = await this.client.appendToDaily(
      input.content,
      date,
      input.separator,
      input.timestamp,
      input.createIfMissing
    );

    this.logger.info('Content appended to daily note', {
      date,
      path: result.path,
      newLength: result.newLength,
      source: result.source,
    });

    return result;
  }
}
