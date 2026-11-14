import { z } from 'zod';
import { BaseTool, type ToolAnnotations } from './base.js';
import type { GetTagsResult, TagInfo } from '../types/obsidian.js';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';
import { parseNote } from '../utils/tags.js';

/**
 * Input schema for get_tags tool
 */
const GetTagsInputSchema = z.object({
  path: z.string().optional(),
  recursive: z.boolean().default(true),
  includeCount: z.boolean().default(true),
});

type GetTagsInput = z.infer<typeof GetTagsInputSchema>;

/**
 * GetTagsTool - Extract and list all tags from notes
 *
 * This tool scans markdown files and extracts tags from:
 * 1. Frontmatter (tags field - can be array or single value)
 * 2. Inline tags (#tag format in content)
 *
 * Features:
 * - Scan entire vault or specific folder
 * - Count tag usage across files
 * - Track which files contain each tag
 * - Support for nested tags (#parent/child)
 * - Deduplicate tags within files
 *
 * Example usage:
 * ```json
 * {
 *   "path": "projects",
 *   "recursive": true,
 *   "includeCount": true
 * }
 * ```
 */
export class GetTagsTool extends BaseTool<GetTagsInput, GetTagsResult> {
  readonly name = 'get_tags';
  readonly description = 'Extract and list all tags from notes in the vault. Supports frontmatter tags and inline #tags.';
  protected readonly inputSchema = GetTagsInputSchema;
  readonly annotations: ToolAnnotations = { title: 'Get tags', readOnlyHint: true };

  /**
   * Execute the tag extraction operation
   *
   * @param input - Validated input with path and options
   * @returns Tags with counts and file locations
   */
  protected async run(input: GetTagsInput): Promise<GetTagsResult> {
    this.logger.debug(`Extracting tags from: ${input.path || 'entire vault'}`);

    // Get the vault path
    const vaultPath = this.client['config'].vaultPath;
    const targetFolder = this.client.resolveSafePath(input.path);

    // Map to track tags: tag -> set of file paths
    const tagMap = new Map<string, Set<string>>();
    const filesWithTags = new Set<string>();

    // Collect all markdown files
    const notes: string[] = [];
    await this.collectNotes(targetFolder, vaultPath, input.recursive ?? true, notes);

    this.logger.debug(`Found ${notes.length} notes to scan for tags`);

    // Process each file
    for (const notePath of notes) {
      const fileTags = await this.extractTagsFromFile(notePath);

      if (fileTags.size > 0) {
        // Use relative path from vault
        const relativePath = relative(vaultPath, notePath);
        filesWithTags.add(relativePath);

        // Add each tag to the map
        for (const tag of fileTags) {
          if (!tagMap.has(tag)) {
            tagMap.set(tag, new Set());
          }
          tagMap.get(tag)!.add(relativePath);
        }
      }
    }

    // Convert map to array of TagInfo
    const tags: TagInfo[] = Array.from(tagMap.entries())
      .map(([tag, files]): TagInfo => ({
        tag,
        count: files.size,
        files: Array.from(files),
      }))
      .sort((a, b) => {
        // Sort by count (descending), then alphabetically
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return a.tag.localeCompare(b.tag);
      });

    this.logger.info(
      `Extracted ${tags.length} unique tags from ${filesWithTags.size} files`
    );

    return {
      tags,
      totalTags: tags.length,
      totalFiles: filesWithTags.size,
    };
  }

  /**
   * Recursively collect all markdown notes from a directory
   *
   * @param dir - Directory to scan
   * @param vaultPath - Root vault path
   * @param recursive - Whether to scan subdirectories
   * @param notes - Array to accumulate note paths
   */
  private async collectNotes(
    dir: string,
    vaultPath: string,
    recursive: boolean,
    notes: string[]
  ): Promise<void> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        // Skip .obsidian folder and other hidden folders
        if (entry.isDirectory()) {
          if (recursive && !entry.name.startsWith('.')) {
            await this.collectNotes(fullPath, vaultPath, recursive, notes);
          }
          continue;
        }

        // Only include markdown files
        if (entry.isFile() && entry.name.endsWith('.md')) {
          notes.push(fullPath);
        }
      }
    } catch (error) {
      // Log but don't fail - skip directories we can't read
      this.logger.warn(`Failed to read directory ${dir}: ${error}`);
    }
  }

  /**
   * Extract all tags from a single file
   *
   * @param absolutePath - Absolute file path to extract tags from
   * @returns Set of unique tags found in the file
   */
  private async extractTagsFromFile(absolutePath: string): Promise<Set<string>> {
    try {
      const vaultPath = this.client['config'].vaultPath;
      const relativePath = relative(vaultPath, absolutePath);
      const { content } = await this.client.readFile(relativePath);
      return parseNote(content).tags;
    } catch (error) {
      // Log but don't fail - skip files that can't be read
      this.logger.warn(`Failed to extract tags from ${absolutePath}: ${error}`);
      return new Set();
    }
  }
}
