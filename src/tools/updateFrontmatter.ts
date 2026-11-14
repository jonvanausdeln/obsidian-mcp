import { z } from 'zod';
import matter from 'gray-matter';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { UpdateFrontmatterResult, FrontmatterData } from '../types/obsidian.js';
import { withFileLock } from '../utils/fileLock.js';

/**
 * Input schema for update_frontmatter tool
 */
const UpdateFrontmatterInputSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  updates: z.record(z.string(), z.unknown()).default({}),
  remove: z.array(z.string()).optional(),
  merge: z.boolean().default(true),
});

type UpdateFrontmatterInput = z.infer<typeof UpdateFrontmatterInputSchema>;

/**
 * UpdateFrontmatterTool - Update YAML frontmatter in a note
 *
 * This tool reads a markdown file, parses its frontmatter, applies updates,
 * removes specified fields, and writes the file back.
 *
 * Features:
 * - Parse YAML frontmatter using gray-matter
 * - Add or update frontmatter fields
 * - Remove specified fields
 * - Merge with existing frontmatter or replace entirely
 * - Preserves content after frontmatter
 * - Creates frontmatter section if it doesn't exist
 *
 * Example usage:
 * ```json
 * {
 *   "path": "notes/my-note.md",
 *   "updates": {
 *     "tags": ["obsidian", "mcp"],
 *     "updated": "2025-11-02",
 *     "status": "complete"
 *   },
 *   "remove": ["draft"],
 *   "merge": true
 * }
 * ```
 */
export class UpdateFrontmatterTool extends BaseTool<UpdateFrontmatterInput, UpdateFrontmatterResult> {
  readonly name = 'update_frontmatter';
  readonly description = 'Update YAML frontmatter in a note. Can add/update fields, remove fields, and merge with or replace existing frontmatter.';
  protected readonly inputSchema = UpdateFrontmatterInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Update frontmatter', readOnlyHint: false, destructiveHint: true, idempotentHint: true };

  /**
   * Execute the frontmatter update operation
   *
   * @param input - Validated input with path, updates, and options
   * @returns Success status, updated frontmatter, and changed fields
   */
  protected async run(input: UpdateFrontmatterInput): Promise<UpdateFrontmatterResult> {
    return withFileLock(input.path, () => this.apply(input));
  }

  private async apply(input: UpdateFrontmatterInput): Promise<UpdateFrontmatterResult> {
    this.logger.debug(`Updating frontmatter in note: ${input.path}`);

    // Read the file
    const { content: fileContent } = await this.client.readFile(input.path);

    // Parse frontmatter
    const parsed = matter(fileContent);
    const existingFrontmatter = (parsed.data || {}) as FrontmatterData;

    this.logger.debug(`Existing frontmatter keys: ${Object.keys(existingFrontmatter).join(', ')}`);

    // Track changes
    const updated: string[] = [];
    const removed: string[] = [];

    // Start with existing frontmatter if merging, otherwise start fresh
    let newFrontmatter: FrontmatterData;
    if (input.merge) {
      newFrontmatter = { ...existingFrontmatter };
    } else {
      newFrontmatter = {};
      // Track all existing fields as being replaced
      Object.keys(existingFrontmatter).forEach((key) => {
        if (!input.updates[key]) {
          removed.push(key);
        }
      });
    }

    // Apply updates
    for (const [key, value] of Object.entries(input.updates)) {
      const isNew = !(key in newFrontmatter);
      const hasChanged = !isNew && newFrontmatter[key] !== value;

      newFrontmatter[key] = value;

      if (isNew || hasChanged) {
        updated.push(key);
      }
    }

    // Remove specified fields
    if (input.remove && input.remove.length > 0) {
      for (const key of input.remove) {
        if (key in newFrontmatter) {
          delete newFrontmatter[key];
          removed.push(key);
        }
      }
    }

    // Reconstruct the file with updated frontmatter
    const updatedContent = matter.stringify(parsed.content, newFrontmatter);

    // Write back to file
    await this.client.writeFile(input.path, updatedContent, true);

    this.logger.info(
      `Updated frontmatter in ${input.path}: ` +
      `${updated.length} fields updated, ${removed.length} fields removed`
    );

    return {
      success: true,
      path: input.path,
      frontmatter: newFrontmatter,
      updated,
      removed,
    };
  }
}
