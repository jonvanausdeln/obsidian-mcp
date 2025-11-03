#!/usr/bin/env tsx
/**
 * Quick test to read the MCP Test Note
 */

import { getConfig } from '../src/utils/config.js';
import { initializeLogger } from '../src/utils/logger.js';
import { RetryManager } from '../src/utils/retry.js';
import { FileSystemClient } from '../src/obsidian/filesystemClient.js';
import { ReadNoteTool } from '../src/tools/readNote.js';

async function main() {
  console.log('Testing read_note tool with MCP Test Note...\n');

  // Initialize
  const config = getConfig();
  const logger = initializeLogger({ ...config, logLevel: 'error' as const });
  const retryManager = new RetryManager(
    {
      maxAttempts: config.retryMaxAttempts,
      baseDelay: config.retryBaseDelay,
    },
    logger
  );
  const client = new FileSystemClient(config, logger, retryManager);
  const readNote = new ReadNoteTool(client, logger);

  try {
    // Test reading the note
    const result = await readNote.execute({ path: 'MCP Test Note.md' });

    console.log('✅ Successfully read test note!\n');
    console.log('File Statistics:');
    console.log(`  Size: ${result.stats.size} bytes`);
    console.log(`  Created: ${result.stats.created}`);
    console.log(`  Modified: ${result.stats.modified}`);
    console.log('\nContent Preview (first 500 chars):');
    console.log('─'.repeat(60));
    console.log(result.content.substring(0, 500));
    console.log('─'.repeat(60));
    console.log(`\n(${result.content.length} total characters)`);

    // Extract frontmatter
    const frontmatterMatch = result.content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      console.log('\n📋 Frontmatter Detected:');
      console.log(frontmatterMatch[1]);
    }

    // Count sections
    const sections = result.content.match(/^#{1,6}\s+.+$/gm);
    console.log(`\n📚 Sections: ${sections?.length || 0} headings found`);

    console.log('\n✨ Test note is ready for MCP operations!');
  } catch (error: any) {
    console.error('❌ Failed to read test note:', error.message);
    process.exit(1);
  }
}

main();
