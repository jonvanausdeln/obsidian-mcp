import { z } from 'zod';
import { BaseTool } from './base.js';
import type { ApplyTemplateResult } from '../types/obsidian.js';
import { getTodayISO, formatDateLong, getCurrentTime } from '../utils/dateUtils.js';

/**
 * Input schema for apply_template tool
 */
const ApplyTemplateInputSchema = z.object({
  path: z.string().min(1, 'Target path is required'),
  templatePath: z.string().min(1, 'Template path is required'),
  variables: z.record(z.string()).optional(),
  position: z.enum(['replace', 'prepend', 'append']).default('replace'),
});

type ApplyTemplateInput = z.infer<typeof ApplyTemplateInputSchema>;

/**
 * ApplyTemplateTool - Apply a template to a note
 *
 * This tool reads a template file, performs variable substitution,
 * and inserts the result into the target file.
 *
 * Features:
 * - Read template from any note in vault
 * - Variable substitution with {{variable}} syntax
 * - Built-in variables: {{date}}, {{time}}, {{date-long}}
 * - Custom variables via parameters
 * - Multiple insertion modes: replace, prepend, append
 * - Creates target file if it doesn't exist
 *
 * Built-in variables:
 * - {{date}} -> Current date (YYYY-MM-DD)
 * - {{time}} -> Current time (HH:MM AM/PM)
 * - {{date-long}} -> Current date (Monday, November 2, 2025)
 *
 * Example usage:
 * ```json
 * {
 *   "path": "projects/new-project.md",
 *   "templatePath": "templates/project-template.md",
 *   "variables": {
 *     "title": "My New Project",
 *     "author": "Claude"
 *   },
 *   "position": "replace"
 * }
 * ```
 */
export class ApplyTemplateTool extends BaseTool<ApplyTemplateInput, ApplyTemplateResult> {
  readonly name = 'apply_template';
  readonly description = 'Apply a template to a note with variable substitution. Supports {{variable}} syntax and built-in variables like {{date}}, {{time}}.';
  protected readonly inputSchema = ApplyTemplateInputSchema;

  /**
   * Execute the template application operation
   *
   * @param input - Validated input with paths, variables, and position
   * @returns Success status and applied variables
   */
  protected async run(input: ApplyTemplateInput): Promise<ApplyTemplateResult> {
    this.logger.debug(
      `Applying template ${input.templatePath} to ${input.path} (position: ${input.position})`
    );

    // Read template file
    let templateContent: string;
    try {
      const { content } = await this.client.readFile(input.templatePath);
      templateContent = content;
    } catch (error) {
      throw new Error(`Failed to read template file: ${input.templatePath}`);
    }

    // Prepare variables with built-ins
    const variables = {
      date: getTodayISO(),
      time: getCurrentTime(),
      'date-long': formatDateLong(new Date()),
      ...(input.variables || {}),
    };

    this.logger.debug(`Applying variables: ${Object.keys(variables).join(', ')}`);

    // Perform variable substitution
    let processedContent = templateContent;
    const appliedVariables: string[] = [];

    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      if (processedContent.includes(placeholder)) {
        processedContent = processedContent.replace(
          new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
          value
        );
        appliedVariables.push(key);
      }
    }

    // Handle insertion based on position
    let finalContent: string;

    if (input.position === 'replace') {
      // Replace entire file
      finalContent = processedContent;
    } else {
      // Read existing content if file exists
      let existingContent = '';
      try {
        const { content } = await this.client.readFile(input.path);
        existingContent = content;
      } catch (error) {
        // File doesn't exist - that's okay for prepend/append
        this.logger.debug(`Target file doesn't exist yet: ${input.path}`);
      }

      if (input.position === 'prepend') {
        finalContent = processedContent + '\n\n' + existingContent;
      } else {
        // append
        finalContent = existingContent + (existingContent ? '\n\n' : '') + processedContent;
      }
    }

    // Write the result
    await this.client.writeFile(input.path, finalContent, true);

    this.logger.info(
      `Applied template ${input.templatePath} to ${input.path} ` +
      `(${appliedVariables.length} variables substituted)`
    );

    return {
      success: true,
      path: input.path,
      templateUsed: input.templatePath,
      variablesApplied: appliedVariables,
    };
  }
}
