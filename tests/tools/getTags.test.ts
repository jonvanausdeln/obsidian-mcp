import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { GetTagsTool } from '../../src/tools/getTags.js';
import { FileSystemClient } from '../../src/obsidian/filesystemClient.js';
import { initializeLogger } from '../../src/utils/logger.js';
import { RetryManager } from '../../src/utils/retry.js';
import { ObsidianErrorType } from '../../src/types/obsidian.js';
import type { Config } from '../../src/utils/config.js';

describe('GetTagsTool', () => {
  let tool: GetTagsTool;
  let testVaultPath: string;

  beforeEach(async () => {
    testVaultPath = join(process.cwd(), 'test-vault-gettags-' + Date.now());
    await fs.mkdir(join(testVaultPath, '.obsidian'), { recursive: true });

    const config: Config = {
      vaultPath: testVaultPath,
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
    tool = new GetTagsTool(client as never, logger);
  });

  afterEach(async () => {
    await fs.rm(testVaultPath, { recursive: true, force: true });
  });

  it('should extract frontmatter and inline tags', async () => {
    await fs.writeFile(join(testVaultPath, 'a.md'), '---\ntags: [project]\n---\nSome #idea here');
    const result = await tool.execute({});
    expect(result.tags.map((t) => t.tag).sort()).toEqual(['idea', 'project']);
  });

  it('should reject a path that escapes the vault', async () => {
    await expect(tool.execute({ path: '..' })).rejects.toMatchObject({
      type: ObsidianErrorType.INVALID_PATH,
    });
  });
});
