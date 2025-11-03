#!/usr/bin/env tsx
/**
 * Test script for append_to_daily tool
 */

import { getConfig } from '../src/utils/config.js';
import { initializeLogger } from '../src/utils/logger.js';
import { RetryManager } from '../src/utils/retry.js';
import { ObsidianClient } from '../src/obsidian/client.js';
import { AppendToDailyTool } from '../src/tools/appendToDaily.js';
import { GetDailyNoteTool } from '../src/tools/getDailyNote.js';

async function main() {
  console.log('=== Testing append_to_daily tool ===\n');

  // 1. Load configuration
  console.log('1. Loading configuration...');
  const config = getConfig();
  console.log(`   Vault path: ${config.vaultPath}`);
  console.log(`   API URL: ${config.apiUrl || 'Not configured'}`);
  console.log(`   API Key: ${config.apiKey ? '***configured***' : 'Not configured'}\n`);

  // 2. Initialize logger and retry manager
  const logger = initializeLogger(config);
  const retryManager = new RetryManager(
    {
      maxAttempts: config.retryMaxAttempts,
      baseDelay: config.retryBaseDelay,
    },
    logger
  );

  // 3. Initialize hybrid client
  console.log('2. Initializing hybrid client...');
  const client = new ObsidianClient(config, logger, retryManager);
  await client.initialize();
  console.log(`   Mode: ${client.getMode()}\n`);

  // 4. Test get_daily_note first
  console.log('3. Testing get_daily_note...');
  const getDailyTool = new GetDailyNoteTool(client, logger);
  try {
    const dailyResult = await getDailyTool.execute({});
    console.log('   ✅ get_daily_note succeeded:');
    console.log(`   Path: ${dailyResult.path}`);
    console.log(`   Exists: ${dailyResult.exists}`);
    console.log(`   Source: ${dailyResult.source}\n`);
  } catch (error) {
    console.error('   ❌ get_daily_note failed:', error);
    console.error('\n');
  }

  // 5. Test append_to_daily
  console.log('4. Testing append_to_daily...');
  const appendTool = new AppendToDailyTool(client, logger);
  try {
    const result = await appendTool.execute({
      content: 'Test entry from append_to_daily script',
      timestamp: true,
      createIfMissing: true,
    });
    console.log('   ✅ append_to_daily succeeded:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Path: ${result.path}`);
    console.log(`   New length: ${result.newLength}`);
    console.log(`   Source: ${result.source}\n`);
  } catch (error) {
    console.error('   ❌ append_to_daily failed:');
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
      console.error(`   Stack: ${error.stack}`);
    } else {
      console.error(`   Error: ${JSON.stringify(error, null, 2)}`);
    }
  }

  console.log('\n=== Test complete ===');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
