import { z } from 'zod';
import matter from 'gray-matter';
import { BaseTool } from './base.js';
import type { GetTagsResult, TagInfo } from '../types/obsidian.js';
import { readdir } from 'fs/promises';
import { join, relative } from 'path';

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
    const targetFolder = input.path ? join(vaultPath, input.path) : vaultPath;

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
    const tags = new Set<string>();

    try {
      // Read file content directly from filesystem
      const vaultPath = this.client['config'].vaultPath;
      const relativePath = relative(vaultPath, absolutePath);
      const { content } = await this.client.readFile(relativePath);

      // Parse frontmatter
      const parsed = matter(content);

      // Extract frontmatter tags
      if (parsed.data && parsed.data.tags) {
        const frontmatterTags = this.normalizeTags(parsed.data.tags);
        frontmatterTags.forEach((tag) => tags.add(tag));
      }

      // Extract inline tags from content
      // Match #tag or #nested/tag/format
      // Negative lookbehind to avoid matching URLs like http://example.com
      const inlineTagRegex = /(?<![\w/])#([\w/-]+)/g;
      const matches = parsed.content.matchAll(inlineTagRegex);

      for (const match of matches) {
        const tag = match[1];
        if (!tag) continue; // Skip if no capture group

        // Skip if it's a pure number (e.g., #123)
        if (/^\d+$/.test(tag)) {
          continue;
        }
        tags.add(tag);
      }
    } catch (error) {
      // Log but don't fail - skip files that can't be read
      this.logger.warn(`Failed to extract tags from ${absolutePath}: ${error}`);
    }

    return tags;
  }

  /**
   * Normalize tags from frontmatter (can be string, array, or nested)
   *
   * @param tags - Tag value from frontmatter
   * @returns Array of normalized tag strings
   */
  private normalizeTags(tags: unknown): string[] {
    if (typeof tags === 'string') {
      return [tags];
    }

    if (Array.isArray(tags)) {
      return tags
        .filter((tag) => typeof tag === 'string')
        .map((tag) => tag.trim());
    }

    return [];
  }
}
