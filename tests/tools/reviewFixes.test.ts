/**
 * Regression tests for code-review findings on the edit/section/search work
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { ObsidianClient } from '../../src/obsidian/client.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import type { Config } from '../../src/utils/config.js';
import { findHeadings, matchHeadings, toLF, restoreEol } from '../../src/utils/markdown.js';
import { frontmatterMatches } from '../../src/utils/tags.js';
import { withFileLock } from '../../src/utils/fileLock.js';
import { ReadNoteTool } from '../../src/tools/readNote.js';
import { UpdateSectionTool } from '../../src/tools/updateSection.js';
import { EditNoteTool } from '../../src/tools/editNote.js';
import { WriteNoteTool } from '../../src/tools/writeNote.js';
import { ApplyTemplateTool } from '../../src/tools/applyTemplate.js';
import { GetTagsTool } from '../../src/tools/getTags.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';

let vault: string;
let config: Config;
let client: FileSystemClient;
let logger: ReturnType<typeof initializeLogger>;

const write = async (name: string, content: string) => {
  await fs.mkdir(dirname(join(vault, name)), { recursive: true });
  await fs.writeFile(join(vault, name), content);
};
const read = (name: string) => fs.readFile(join(vault, name), 'utf-8');

beforeEach(async () => {
  vault = join(process.cwd(), 'test-vault-fixes-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6));
  await fs.mkdir(join(vault, '.obsidian'), { recursive: true });
  config = {
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

describe('heading parsing', () => {
  it('keeps a trailing # that is part of the text', () => {
    expect(findHeadings(['## C#', '## F# notes', '## Title ##', '# #']).map((h) => h.text)).toEqual([
      'C#',
      'F# notes',
      'Title',
      '',
    ]);
  });

  it('selects headings that contain ">"', () => {
    const lines = ['## Inbox -> Done', 'x', '## Groceries', '### Produce', 'y'];
    const headings = findHeadings(lines);
    expect(matchHeadings(headings, lines.length, 'Inbox -> Done')).toEqual([0]);
    expect(matchHeadings(headings, lines.length, 'Groceries > Produce')).toEqual([2]);
    expect(matchHeadings(headings, lines.length, 'Groceries>Produce')).toEqual([2]);
  });

  it('update_section finds "## C#" and creates "Inbox -> Done" as one heading', async () => {
    const tool = new UpdateSectionTool(client as never, logger);
    await write('n.md', '## C#\nold\n');
    await tool.execute({ path: 'n.md', heading: 'C#', content: 'new' });
    expect(await read('n.md')).toBe('## C#\nnew\n');

    await tool.execute({ path: 'n.md', heading: 'Inbox -> Done', content: '- a', createIfMissing: true });
    expect(await read('n.md')).toBe('## C#\nnew\n\n## Inbox -> Done\n- a\n');
  });
});

describe('line endings', () => {
  it('uses the dominant line ending so a stray CRLF does not convert the note', () => {
    const { text, eol } = toLF('a\nb\r\nc\n');
    expect(eol).toBe('\n');
    expect(restoreEol(text, eol)).toBe('a\nb\nc\n');
    expect(toLF('a\r\nb\r\nc\n').eol).toBe('\r\n');
  });

  it('edit_note on a mostly-LF note keeps LF', async () => {
    await write('list.md', '- [ ] milk\n- [ ] eggs\r\n- [ ] bread\n- [ ] jam\n');
    await new EditNoteTool(client as never, logger).execute({
      path: 'list.md',
      edits: [{ oldText: '- [ ] milk', newText: '- [x] milk' }],
    });
    expect(await read('list.md')).toBe('- [x] milk\n- [ ] eggs\n- [ ] bread\n- [ ] jam\n');
  });
});

describe('section error types', () => {
  it('read_note reports a missing heading as SECTION_NOT_FOUND, not FILE_NOT_FOUND', async () => {
    await write('n.md', '## A\nx\n## A\ny\n');
    const tool = new ReadNoteTool(client as never, logger);
    await expect(tool.execute({ path: 'n.md', heading: 'B' })).rejects.toMatchObject({
      type: ObsidianErrorType.SECTION_NOT_FOUND,
    });
    await expect(tool.execute({ path: 'n.md', heading: 'A' })).rejects.toMatchObject({
      type: ObsidianErrorType.AMBIGUOUS_HEADING,
    });
    await expect(tool.execute({ path: 'n.md', heading: 'A', occurrence: 3 })).rejects.toMatchObject({
      type: ObsidianErrorType.AMBIGUOUS_HEADING,
    });
  });
});

describe('locking', () => {
  it('normalizes lock keys for equivalent paths', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = withFileLock('Lists//Shopping.md', async () => {
      await gate;
      order.push('first');
    });
    const second = withFileLock('./lists/./shopping.md', async () => {
      order.push('second');
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]); // second is waiting on the same lock
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('parallel append_to_daily on a new day keeps every entry', async () => {
    const obsidian = new ObsidianClient(config, logger, new RetryManager({ maxAttempts: 1, baseDelay: 10 }, logger));
    await Promise.all(
      ['one', 'two', 'three'].map((entry) => obsidian.appendToDaily(entry, '2026-11-14', '\n', false, true))
    );
    const files = await fs.readdir(join(vault, 'Daily Notes'));
    const text = await read(join('Daily Notes', files[0]!));
    for (const entry of ['one', 'two', 'three']) expect(text).toContain(entry);
    expect(text.match(/^# /gm)).toHaveLength(1);
  });

  it('apply_template append and edit_note in parallel both land', async () => {
    await write('Templates/t.md', '## Added\nfrom template');
    await write('n.md', 'keep me\n');
    await Promise.all([
      new ApplyTemplateTool(client as never, logger).execute({
        path: 'n.md',
        templatePath: 'Templates/t.md',
        position: 'append',
      }),
      new EditNoteTool(client as never, logger).execute({
        path: 'n.md',
        edits: [{ oldText: 'keep me', newText: 'kept' }],
      }),
    ]);
    const text = await read('n.md');
    expect(text).toContain('kept');
    expect(text).toContain('from template');
  });

  it('write_note waits for an in-flight edit on the same note', async () => {
    await write('n.md', 'a\n');
    await Promise.all([
      new EditNoteTool(client as never, logger).execute({ path: 'n.md', edits: [{ oldText: 'a', newText: 'b' }] }),
      new WriteNoteTool(client as never, logger).execute({ path: 'n.md', content: 'fresh\n', overwrite: true }),
    ]);
    expect(await read('n.md')).toBe('fresh\n');
  });
});

describe('get_tags paths', () => {
  it('returns forward-slash paths like the other tools', async () => {
    await write('Recipes/Dinner/curry.md', '---\ntags: [recipe]\n---\nx');
    const r = await new GetTagsTool(client as never, logger).execute({});
    expect(r.tags.find((t) => t.tag === 'recipe')!.files).toEqual(['Recipes/Dinner/curry.md']);
  });
});

describe('frontmatter filters and templates', () => {
  it('matches numbers and booleans given as strings', () => {
    expect(frontmatterMatches({ rating: 5 }, { rating: '5' })).toBe(true);
    expect(frontmatterMatches({ rating: '5' }, { rating: 5 })).toBe(true);
    expect(frontmatterMatches({ done: true }, { done: 'TRUE' })).toBe(true);
    expect(frontmatterMatches({ rating: 4 }, { rating: '5' })).toBe(false);
  });

  it('apply_template keeps $ patterns in variable values literal', async () => {
    await write('Templates/p.md', 'Price: {{price}}');
    await new ApplyTemplateTool(client as never, logger).execute({
      path: 'out.md',
      templatePath: 'Templates/p.md',
      variables: { price: "$&5 and $' too" },
    });
    expect(await read('out.md')).toBe("Price: $&5 and $' too");
  });
});
