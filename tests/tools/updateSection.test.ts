import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { UpdateSectionTool } from '../../src/tools/updateSection.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';

const SHOPPING = [
  '---',
  'tags: [list]',
  '# not a heading (frontmatter)',
  '---',
  '# Shopping',
  '',
  '## Produce',
  '- apples',
  '- kale',
  '',
  '### Herbs',
  '- basil',
  '',
  '## Dairy',
  '- milk',
  '',
  '```md',
  '## Produce',
  '```',
  '',
].join('\n');

describe('UpdateSectionTool', () => {
  let tool: UpdateSectionTool;
  let vault: string;
  const write = (name: string, content: string) => fs.writeFile(join(vault, name), content);
  const read = (name: string) => fs.readFile(join(vault, name), 'utf-8');

  beforeEach(async () => {
    vault = join(process.cwd(), 'test-vault-updatesection-' + Date.now());
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
    tool = new UpdateSectionTool(client as never, logger);
    await write('shop.md', SHOPPING);
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it('only requires path, heading and content in its MCP schema', () => {
    const schema = tool.toMCPTool().inputSchema;
    expect([...(schema.required ?? [])].sort()).toEqual(['content', 'heading', 'path']);
  });

  it('appends to the heading own content, before sub-headings', async () => {
    const result = await tool.execute({ path: 'shop.md', heading: 'Produce', content: '- pears', mode: 'append' });
    expect(result).toMatchObject({ sectionFound: true, created: false, headingLevel: 2 });
    const text = await read('shop.md');
    expect(text).toContain('## Produce\n- apples\n- kale\n- pears\n\n### Herbs\n- basil');
    // The fenced-code "## Produce" must be untouched
    expect(text).toContain('```md\n## Produce\n```');
  });

  it('prepends right after the heading', async () => {
    await tool.execute({ path: 'shop.md', heading: 'Dairy', content: '- butter', mode: 'prepend' });
    expect(await read('shop.md')).toContain('## Dairy\n- butter\n- milk\n');
  });

  it('replace keeps sub-headings by default', async () => {
    await tool.execute({ path: 'shop.md', heading: 'Produce', content: '- onions' });
    expect(await read('shop.md')).toContain('## Produce\n- onions\n\n### Herbs\n- basil\n\n## Dairy');
  });

  it('replace with includeSubsections covers the whole section', async () => {
    await tool.execute({ path: 'shop.md', heading: 'Produce', content: '- onions', includeSubsections: true });
    const text = await read('shop.md');
    expect(text).toContain('## Produce\n- onions\n\n## Dairy');
    expect(text).not.toContain('Herbs');
  });

  it('supports Parent > Child selectors and #-level pinning', async () => {
    await tool.execute({ path: 'shop.md', heading: 'Produce > Herbs', content: '- dill', mode: 'append' });
    expect(await read('shop.md')).toContain('### Herbs\n- basil\n- dill\n');
    await expect(tool.execute({ path: 'shop.md', heading: '# Produce', content: 'x' })).rejects.toMatchObject({
      type: ObsidianErrorType.SECTION_NOT_FOUND,
    });
  });

  it('matches headings case-insensitively', async () => {
    await tool.execute({ path: 'shop.md', heading: 'PRODUCE > herbs', content: '- mint', mode: 'append' });
    expect(await read('shop.md')).toContain('- basil\n- mint\n');
  });

  it('errors with the available headings when not found', async () => {
    await expect(tool.execute({ path: 'shop.md', heading: 'Bakery', content: '- bread' })).rejects.toMatchObject({
      type: ObsidianErrorType.SECTION_NOT_FOUND,
      details: { suggestedAction: expect.stringContaining('## Dairy') },
    });
  });

  it('creates a missing heading at the end of the note', async () => {
    const result = await tool.execute({ path: 'shop.md', heading: 'Bakery', content: '- bread', createIfMissing: true });
    expect(result).toMatchObject({ created: true, sectionFound: false, headingLevel: 2 });
    expect(await read('shop.md')).toMatch(/```\n\n## Bakery\n- bread\n$/);
  });

  it('creates a missing child inside its parent section', async () => {
    await tool.execute({ path: 'shop.md', heading: 'Produce > Fruit', content: '- figs', createIfMissing: true });
    expect(await read('shop.md')).toContain('### Herbs\n- basil\n\n### Fruit\n- figs\n\n## Dairy');
  });

  it('errors on duplicate headings unless occurrence is given', async () => {
    await write('dup.md', '## Notes\na\n## Notes\nb\n');
    await expect(tool.execute({ path: 'dup.md', heading: 'Notes', content: 'x' })).rejects.toMatchObject({
      type: ObsidianErrorType.AMBIGUOUS_HEADING,
      message: expect.stringContaining('matches 2'),
    });
    await tool.execute({ path: 'dup.md', heading: 'Notes', content: 'x', occurrence: 2 });
    expect(await read('dup.md')).toBe('## Notes\na\n## Notes\nx\n');
  });

  it('handles a heading at end of file with no trailing newline', async () => {
    await write('eof.md', '# Log\n## Today');
    await tool.execute({ path: 'eof.md', heading: 'Today', content: '- did a thing', mode: 'append' });
    expect(await read('eof.md')).toBe('# Log\n## Today\n- did a thing');
  });

  it('preserves CRLF line endings', async () => {
    await write('crlf.md', '## Tasks\r\n- [ ] a\r\n\r\n## Done\r\n');
    await tool.execute({ path: 'crlf.md', heading: 'Tasks', content: '- [ ] b', mode: 'append' });
    expect(await read('crlf.md')).toBe('## Tasks\r\n- [ ] a\r\n- [ ] b\r\n\r\n## Done\r\n');
  });

  it('keeps a blank line after the heading when the note uses one', async () => {
    await write('blank.md', '## Tasks\n\n- a\n\n## Done\n');
    await tool.execute({ path: 'blank.md', heading: 'Tasks', content: '- b', mode: 'append' });
    expect(await read('blank.md')).toBe('## Tasks\n\n- a\n- b\n\n## Done\n');
  });
});
