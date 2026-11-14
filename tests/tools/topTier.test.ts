import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import type { Config } from '../../src/utils/config.js';
import type { BaseTool } from '../../src/tools/base.js';
import { ReadNoteTool } from '../../src/tools/readNote.js';
import { SearchNotesTool } from '../../src/tools/searchNotes.js';
import { ListNotesTool } from '../../src/tools/listNotes.js';
import { WriteNoteTool } from '../../src/tools/writeNote.js';
import { AppendNoteTool } from '../../src/tools/appendNote.js';
import { EditNoteTool } from '../../src/tools/editNote.js';
import { UpdateSectionTool } from '../../src/tools/updateSection.js';
import { GetDailyNoteTool } from '../../src/tools/getDailyNote.js';
import { AppendToDailyTool } from '../../src/tools/appendToDaily.js';
import { UpdateFrontmatterTool } from '../../src/tools/updateFrontmatter.js';
import { GetTagsTool } from '../../src/tools/getTags.js';
import { ApplyTemplateTool } from '../../src/tools/applyTemplate.js';
import { DeleteNoteTool } from '../../src/tools/deleteNote.js';
import { GetActiveFileTool } from '../../src/tools/getActiveFile.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';

let vault: string;
let client: FileSystemClient;
let logger: ReturnType<typeof initializeLogger>;

const write = async (name: string, content: string) => {
  await fs.mkdir(dirname(join(vault, name)), { recursive: true });
  await fs.writeFile(join(vault, name), content);
};

beforeEach(async () => {
  vault = join(process.cwd(), 'test-vault-toptier-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  await fs.mkdir(join(vault, '.obsidian'), { recursive: true });
  const config = {
    vaultPath: vault,
    logLevel: 'error',
    maxFileSizeMB: 1,
    enableDelete: true,
    retryMaxAttempts: 1,
    retryBaseDelay: 10,
    verifySsl: false,
    dailyNotesFolders: ['Daily Notes'],
  } as Config;
  logger = initializeLogger(config);
  client = new FileSystemClient(config, logger, new RetryManager({ maxAttempts: 1, baseDelay: 10 }, logger));
});

afterEach(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe('tool annotations', () => {
  it('every tool declares readOnlyHint and is closed-world', () => {
    const c = client as never;
    const tools: BaseTool<any, any>[] = [
      new ReadNoteTool(c, logger), new WriteNoteTool(c, logger), new AppendNoteTool(c, logger),
      new EditNoteTool(c, logger), new UpdateSectionTool(c, logger), new ListNotesTool(c, logger),
      new SearchNotesTool(c, logger), new GetDailyNoteTool(c, logger), new AppendToDailyTool(c, logger),
      new UpdateFrontmatterTool(c, logger), new GetTagsTool(c, logger), new ApplyTemplateTool(c, logger),
      new DeleteNoteTool(c, logger), new GetActiveFileTool(c, logger),
    ];
    const readOnly = new Set(['read_note', 'list_notes', 'search_notes', 'get_daily_note', 'get_tags', 'get_active_file']);
    for (const tool of tools) {
      const a = tool.toMCPTool().annotations!;
      expect(a.readOnlyHint, tool.name).toBe(readOnly.has(tool.name));
      expect(a.openWorldHint, tool.name).toBe(false);
      if (!a.readOnlyHint) expect(typeof a.destructiveHint, tool.name).toBe('boolean');
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.toMCPTool().annotations!]));
    expect(byName.delete_note!.destructiveHint).toBe(true);
    expect(byName.append_note!.destructiveHint).toBe(false);
  });
});

describe('read_note sections and outline', () => {
  const DRAFT = '# Chapter 1\nIntro\n\n## Scene A\nA text\n\n### Beat\nbeat\n\n## Scene B\nB text\n\n```\n## not a heading\n```\n';
  let tool: ReadNoteTool;
  beforeEach(async () => {
    tool = new ReadNoteTool(client as never, logger);
    await write('draft.md', DRAFT);
  });

  it('plain read is unchanged', async () => {
    const r = await tool.execute({ path: 'draft.md' });
    expect(r.content).toBe(DRAFT);
    expect(r.outline).toBeUndefined();
  });

  it('returns the outline without content', async () => {
    const r = await tool.execute({ path: 'draft.md', outline: true, includeContent: false });
    expect(r.content).toBeUndefined();
    expect(r.outline).toEqual([
      { level: 1, text: 'Chapter 1', line: 1 },
      { level: 2, text: 'Scene A', line: 4 },
      { level: 3, text: 'Beat', line: 7 },
      { level: 2, text: 'Scene B', line: 10 },
    ]);
  });

  it('reads one section including subsections by default', async () => {
    const r = await tool.execute({ path: 'draft.md', heading: 'Scene A' });
    expect(r.content).toBe('## Scene A\nA text\n\n### Beat\nbeat');
    expect(r.section).toEqual({ heading: 'Scene A', level: 2, startLine: 4, endLine: 8 });
  });

  it('can stop at the first sub-heading', async () => {
    const r = await tool.execute({ path: 'draft.md', heading: 'Scene A', includeSubsections: false });
    expect(r.content).toBe('## Scene A\nA text');
  });

  it('supports nested selectors and reports available headings when missing', async () => {
    expect((await tool.execute({ path: 'draft.md', heading: 'Scene A > Beat' })).content).toBe('### Beat\nbeat');
    await expect(tool.execute({ path: 'draft.md', heading: 'Scene C' })).rejects.toMatchObject({
      details: { suggestedAction: expect.stringContaining('## Scene B') },
    });
  });

  it('includes a code block that belongs to the last section', async () => {
    const r = await tool.execute({ path: 'draft.md', heading: 'Scene B' });
    expect(r.content).toBe('## Scene B\nB text\n\n```\n## not a heading\n```');
  });
});

describe('search_notes filters and limits', () => {
  let tool: SearchNotesTool;
  beforeEach(async () => {
    tool = new SearchNotesTool(client as never, logger);
    await write('Recipes/curry.md', '---\ntags: [recipe/dinner]\ncourse: Dinner\nservings: 4\n---\nChicken curry\n');
    await write('Recipes/pancakes.md', '---\ntags: recipe, breakfast\ncourse: breakfast\n---\nPancakes\n');
    await write('Recipes/salad.md', '---\ncourse: dinner\nstatus: draft\n---\nChicken salad #recipe\n');
    await write('Blog/post.md', '---\nstatus: draft\ntags: [blog]\n---\nChicken is mentioned here too\n');
  });

  it('filters by tag (nested and inline) without a query', async () => {
    const r = await tool.execute({ tags: ['recipe'] });
    expect(r.results.map((x) => x.path).sort()).toEqual([
      'Recipes/curry.md',
      'Recipes/pancakes.md',
      'Recipes/salad.md',
    ]);
    expect(r.matchedFiles).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('combines tags, frontmatter and text', async () => {
    const r = await tool.execute({ tags: ['recipe'], frontmatter: { course: 'DINNER' }, query: 'chicken' });
    expect(r.results.map((x) => x.path).sort()).toEqual(['Recipes/curry.md', 'Recipes/salad.md']);
  });

  it('supports tagMatch any, list containment, null for absent keys, and includeFrontmatter', async () => {
    const any = await tool.execute({ tags: ['breakfast', 'blog'], tagMatch: 'any' });
    expect(any.results.map((x) => x.path).sort()).toEqual(['Blog/post.md', 'Recipes/pancakes.md']);

    const noStatus = await tool.execute({ tags: ['recipe'], frontmatter: { status: null } });
    expect(noStatus.results.map((x) => x.path).sort()).toEqual(['Recipes/curry.md', 'Recipes/pancakes.md']);

    const fm = await tool.execute({ frontmatter: { servings: 4 }, includeFrontmatter: true });
    expect(fm.results).toHaveLength(1);
    expect(fm.results[0]!.frontmatter).toMatchObject({ course: 'Dinner', servings: 4 });
  });

  it('requires a query or a filter', async () => {
    await expect(tool.execute({})).rejects.toThrow(/query, tags, or frontmatter/);
  });

  it('caps results and reports truncated', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `todo ${i}`).join('\n');
    await write('big.md', lines);
    const r = await tool.execute({ query: 'todo' });
    expect(r.results[0]!.matches).toHaveLength(50);
    expect(r.totalMatches).toBe(80);
    expect(r.truncated).toBe(true);
    expect(r.results[0]!.matches[0]!.context?.before).toEqual([]);
    expect(r.results[0]!.matches[1]!.context?.before).toEqual(['todo 0']);
  });
});

describe('list_notes default limit', () => {
  it('returns at most 200 notes and reports hasMore', async () => {
    for (let i = 0; i < 205; i++) await write(`n/${String(i).padStart(3, '0')}.md`, 'x');
    const tool = new ListNotesTool(client as never, logger);
    const first = await tool.execute({});
    expect(first.notes).toHaveLength(200);
    expect(first.hasMore).toBe(true);
    const rest = await tool.execute({ offset: 200 });
    expect(rest.notes).toHaveLength(5);
    expect(rest.hasMore).toBe(false);
  });
});
