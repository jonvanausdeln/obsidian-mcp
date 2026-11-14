import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { ActiveFileInfo } from '../types/obsidian.js';

const GetActiveFileInputSchema = z.object({}).strict();

type GetActiveFileInput = z.infer<typeof GetActiveFileInputSchema>;

interface GetActiveFileResult {
  available: boolean;
  file: ActiveFileInfo | null;
}

/**
 * GetActiveFileTool - Get the currently active (open) file in Obsidian
 *
 * This is an API-only tool. Returns null when the REST API is unavailable
 * (Obsidian not running or plugin not installed).
 */
export class GetActiveFileTool extends BaseTool<GetActiveFileInput, GetActiveFileResult> {
  readonly name = 'get_active_file';
  readonly description =
    'Get the currently active (open) file in Obsidian. ' +
    'Requires the Obsidian REST API plugin. Returns null if Obsidian is not running.';
  protected readonly inputSchema = GetActiveFileInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Get active file', readOnlyHint: true };

  protected async run(_input: GetActiveFileInput): Promise<GetActiveFileResult> {
    this.logger.debug('Getting active file');
    const file = await this.client.getActiveFile();

    if (!file) {
      return {
        available: false,
        file: null,
      };
    }

    return {
      available: true,
      file,
    };
  }
}
