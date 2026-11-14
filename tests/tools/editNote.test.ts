import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { EditNoteTool } from '../../src/tools/editNote.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';

describe('EditNoteTool', () => {
  let tool: EditNoteTool;
  let vault: string;
  const write = (name: string, content: string) => fs.writeFile(join(vault, name), content);
  const read = (name: string) => fs.readFile(join(vault, name), 'utf-8');

  beforeEach(async () => {
    vault = join(process.cwd(), 'test-vault-editnote-' + Date.now());
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
    const logger = initializeLogger(config);
    const client = new FileSystemClient(config, logger, new RetryManager({ maxAttempts: 1, baseDelay: 10 }, logger));
    tool = new EditNoteTool(client as never, logger);
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('exposes path and edits as required in its MCP schema', () => {
    const schema = tool.toMCPTool().inputSchema;
    expect(schema.required).toEqual(expect.arrayContaining(['path', 'edits']));
  });

  it('replaces a unique occurrence', async () => {
    await write('list.md', '# Shopping\n- [ ] eggs\n- [ ] milk\n');
    const result = await tool.execute({ path: 'list.md', edits: [{ oldText: '- [ ] eggs', newText: '- [x] eggs' }] });
    expect(result.replacements).toBe(1);
    expect(await read('list.md')).toBe('# Shopping\n- [x] eggs\n- [ ] milk\n');
  });

  it('applies multiple edits in order', async () => {
    await write('n.md', 'alpha beta gamma');
    await tool.execute({
      path: 'n.md',
      edits: [
        { oldText: 'alpha', newText: 'ALPHA' },
        { oldText: 'ALPHA beta', newText: 'one two' },
      ],
    });
    expect(await read('n.md')).toBe('one two gamma');
  });

  it('is all-or-nothing when a later edit fails', async () => {
    await write('n.md', 'keep me');
    await expect(
      tool.execute({
        path: 'n.md',
        edits: [
          { oldText: 'keep', newText: 'changed' },
          { oldText: 'missing', newText: 'x' },
        ],
      })
    ).rejects.toMatchObject({ type: ObsidianErrorType.EDIT_FAILED, message: expect.stringContaining('Edit 2') });
    expect(await read('n.md')).toBe('keep me');
  });

  it('rejects ambiguous matches unless replaceAll is set', async () => {
    await write('n.md', 'x x x');
    await expect(tool.execute({ path: 'n.md', edits: [{ oldText: 'x', newText: 'y' }] })).rejects.toMatchObject({
      type: ObsidianErrorType.EDIT_FAILED,
      message: expect.stringContaining('3 times'),
    });
    const result = await tool.execute({ path: 'n.md', edits: [{ oldText: 'x', newText: 'y', replaceAll: true }] });
    expect(result.replacements).toBe(3);
    expect(await read('n.md')).toBe('y y y');
  });

  it('can delete text with an empty newText', async () => {
    await write('n.md', 'a\n- remove me\nb\n');
    await tool.execute({ path: 'n.md', edits: [{ oldText: '- remove me\n', newText: '' }] });
    expect(await read('n.md')).toBe('a\nb\n');
  });

  it('treats $ in newText literally', async () => {
    await write('n.md', 'price: TBD');
    await tool.execute({ path: 'n.md', edits: [{ oldText: 'TBD', newText: '$& $1 $$' }] });
    expect(await read('n.md')).toBe('price: $& $1 $$');
  });

  it('matches LF input against CRLF notes and keeps CRLF', async () => {
    await write('crlf.md', '- [ ] eggs\r\n- [ ] milk\r\n');
    await tool.execute({ path: 'crlf.md', edits: [{ oldText: '- [ ] eggs\n- [ ] milk', newText: '- [x] eggs\n- [x] milk' }] });
    expect(await read('crlf.md')).toBe('- [x] eggs\r\n- [x] milk\r\n');
  });

  it('fails for missing notes and paths outside the vault', async () => {
    await expect(tool.execute({ path: 'nope.md', edits: [{ oldText: 'a', newText: 'b' }] })).rejects.toMatchObject({
      type: ObsidianErrorType.FILE_NOT_FOUND,
    });
    await expect(tool.execute({ path: '../x.md', edits: [{ oldText: 'a', newText: 'b' }] })).rejects.toMatchObject({
      type: ObsidianErrorType.INVALID_PATH,
    });
  });

  it('does not lose edits when called in parallel on the same note', async () => {
    const items = Array.from({ length: 10 }, (_, i) => `- [ ] item${i}`);
    await write('par.md', items.join('\n') + '\n');
    await Promise.all(
      items.map((item) => tool.execute({ path: 'par.md', edits: [{ oldText: item, newText: item.replace('[ ]', '[x]') }] }))
    );
    const text = await read('par.md');
    expect(text).not.toContain('[ ]');
    expect(text.match(/\[x\]/g)).toHaveLength(10);
  });

  it('rejects empty oldText', async () => {
    await write('n.md', 'a');
    await expect(tool.execute({ path: 'n.md', edits: [{ oldText: '', newText: 'b' }] })).rejects.toThrow(/oldText/);
  });
});
