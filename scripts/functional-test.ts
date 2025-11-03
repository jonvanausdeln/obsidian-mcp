#!/usr/bin/env tsx
/**
 * Functional Test Script for Obsidian MCP Server
 *
 * Tests the complete system with a real vault by:
 * 1. Initializing all components
 * 2. Testing file operations
 * 3. Testing MCP tool execution
 * 4. Verifying error handling
 *
 * Usage: npm run test:functional
 */

import { getConfig } from '../src/utils/config.js';
import { initializeLogger } from '../src/utils/logger.js';
import { RetryManager } from '../src/utils/retry.js';
import { FileSystemClient } from '../src/obsidian/filesystemClient.js';
import { ReadNoteTool } from '../src/tools/readNote.js';
import { WriteNoteTool } from '../src/tools/writeNote.js';
import { AppendNoteTool } from '../src/tools/appendNote.js';
import { ListNotesTool } from '../src/tools/listNotes.js';
import { SearchNotesTool } from '../src/tools/searchNotes.js';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, error?: string, details?: any) {
  results.push({ name, passed, error, details });
  const symbol = passed ? '✅' : '❌';
  console.log(`${symbol} ${name}`);
  if (error) {
    console.log(`   Error: ${error}`);
  }
  if (details) {
    console.log(`   Details:`, details);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Obsidian MCP Server - Functional Test');
  console.log('='.repeat(60));
  console.log();

  // 1. Test Configuration Loading
  console.log('📋 Testing Configuration...');
  let config;
  let logger;
  let client;
  let readNoteTool;
  let writeNoteTool;
  let appendNoteTool;
  let listNotesTool;
  let searchNotesTool;

  try {
    config = getConfig();
    logTest('Load configuration from .env', true, undefined, {
      vaultPath: config.vaultPath,
      logLevel: config.logLevel,
      maxFileSizeMB: config.maxFileSizeMB,
    });
  } catch (error) {
    logTest('Load configuration from .env', false, String(error));
    console.log('\n❌ Configuration failed. Cannot continue.');
    process.exit(1);
  }

  // 2. Test Logger Initialization
  try {
    logger = initializeLogger(config);
    logTest('Initialize logger', true);
  } catch (error) {
    logTest('Initialize logger', false, String(error));
    process.exit(1);
  }

  // 3. Test Client Initialization
  console.log();
  console.log('🔧 Testing FileSystemClient...');
  try {
    const retryManager = new RetryManager(
      {
        maxAttempts: config.retryMaxAttempts,
        baseDelay: config.retryBaseDelay,
      },
      logger
    );
    client = new FileSystemClient(config, logger, retryManager);
    logTest('Initialize FileSystemClient', true);
  } catch (error) {
    logTest('Initialize FileSystemClient', false, String(error));
    process.exit(1);
  }

  // 4. Test Vault Access
  try {
    const files = await client.listFiles('', false);
    logTest('List files in vault root', true, undefined, {
      filesFound: files.length,
      sampleFiles: files.slice(0, 3).map(f => f.name),
    });

    if (files.length === 0) {
      console.log('   ⚠️  Warning: No markdown files found in vault root');
    }
  } catch (error) {
    logTest('List files in vault root', false, String(error));
  }

  // 5. Test Reading a Note (if any exist)
  try {
    const files = await client.listFiles('', true);
    if (files.length > 0) {
      const firstFile = files[0];
      const content = await client.readFile(firstFile.path);
      logTest('Read first note from vault', true, undefined, {
        path: firstFile.path,
        size: content.stats.size,
        contentPreview: content.content.substring(0, 100) + (content.content.length > 100 ? '...' : ''),
      });
    } else {
      logTest('Read first note from vault', false, 'No files found in vault');
    }
  } catch (error) {
    logTest('Read first note from vault', false, String(error));
  }

  // 6. Test Tool Initialization
  console.log();
  console.log('🛠️  Testing MCP Tools...');
  try {
    readNoteTool = new ReadNoteTool(client, logger);
    logTest('Initialize ReadNoteTool', true, undefined, {
      toolName: readNoteTool.name,
      description: readNoteTool.description,
    });
  } catch (error) {
    logTest('Initialize ReadNoteTool', false, String(error));
    process.exit(1);
  }

  try {
    writeNoteTool = new WriteNoteTool(client, logger);
    logTest('Initialize WriteNoteTool', true, undefined, {
      toolName: writeNoteTool.name,
    });
  } catch (error) {
    logTest('Initialize WriteNoteTool', false, String(error));
    process.exit(1);
  }

  try {
    appendNoteTool = new AppendNoteTool(client, logger);
    logTest('Initialize AppendNoteTool', true, undefined, {
      toolName: appendNoteTool.name,
    });
  } catch (error) {
    logTest('Initialize AppendNoteTool', false, String(error));
    process.exit(1);
  }

  try {
    listNotesTool = new ListNotesTool(client, logger);
    logTest('Initialize ListNotesTool', true, undefined, {
      toolName: listNotesTool.name,
    });
  } catch (error) {
    logTest('Initialize ListNotesTool', false, String(error));
    process.exit(1);
  }

  try {
    searchNotesTool = new SearchNotesTool(client, logger);
    logTest('Initialize SearchNotesTool', true, undefined, {
      toolName: searchNotesTool.name,
    });
  } catch (error) {
    logTest('Initialize SearchNotesTool', false, String(error));
    process.exit(1);
  }

  // 7. Test MCP Tool Definition
  try {
    const mcpDef = readNoteTool.toMCPTool();
    logTest('Generate MCP tool definition', true, undefined, {
      name: mcpDef.name,
      hasDescription: !!mcpDef.description,
      hasSchema: !!mcpDef.inputSchema,
      requiredFields: mcpDef.inputSchema.required,
    });
  } catch (error) {
    logTest('Generate MCP tool definition', false, String(error));
  }

  // 8. Test Tool Execution
  try {
    const files = await client.listFiles('', true);
    if (files.length > 0) {
      const firstFile = files[0];
      const result = await readNoteTool.execute({ path: firstFile.path });
      logTest('Execute read_note tool', true, undefined, {
        path: firstFile.path,
        contentLength: result.content.length,
        fileSize: result.stats.size,
        modified: result.stats.modified,
      });
    } else {
      logTest('Execute read_note tool', false, 'No files found in vault');
    }
  } catch (error) {
    logTest('Execute read_note tool', false, String(error));
  }

  // 8b. Test write_note tool
  const testNotePath = 'functional-test-temp.md';
  try {
    const testContent = '# Functional Test\n\nThis is a test note created at ' + new Date().toISOString();
    const result = await writeNoteTool.execute({
      path: testNotePath,
      content: testContent,
      overwrite: false,
      createDirs: true,
    });
    logTest('Execute write_note tool (create)', true, undefined, {
      path: result.path,
      created: result.created,
      success: result.success,
    });
  } catch (error) {
    logTest('Execute write_note tool (create)', false, String(error));
  }

  // 8c. Test write_note overwrite protection
  try {
    await writeNoteTool.execute({
      path: testNotePath,
      content: 'Should fail',
      overwrite: false,
    });
    logTest('Execute write_note tool (overwrite protection)', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isCorrectError = error.message?.includes('already exists');
    logTest('Execute write_note tool (overwrite protection)', isCorrectError, undefined, {
      message: error.message,
    });
  }

  // 8d. Test append_note tool
  try {
    const appendContent = '\n## Appended Section\n\nThis content was appended.';
    const result = await appendNoteTool.execute({
      path: testNotePath,
      content: appendContent,
      separator: '\n',
    });
    logTest('Execute append_note tool', true, undefined, {
      success: result.success,
      newLength: result.newLength,
    });
  } catch (error) {
    logTest('Execute append_note tool', false, String(error));
  }

  // 8e. Test append_note with timestamp
  try {
    const result = await appendNoteTool.execute({
      path: testNotePath,
      content: 'Timestamped entry',
      separator: '\n',
      timestamp: true,
    });
    logTest('Execute append_note tool (with timestamp)', true, undefined, {
      success: result.success,
      newLength: result.newLength,
    });
  } catch (error) {
    logTest('Execute append_note tool (with timestamp)', false, String(error));
  }

  // 8f. Test list_notes tool
  try {
    const result = await listNotesTool.execute({
      folder: '',
      recursive: true,
      sortBy: 'name',
      order: 'asc',
      limit: 10,
    });
    logTest('Execute list_notes tool', true, undefined, {
      total: result.total,
      notesReturned: result.notes.length,
      hasTestNote: result.notes.some(n => n.path === testNotePath),
    });
  } catch (error) {
    logTest('Execute list_notes tool', false, String(error));
  }

  // 8g. Test list_notes with pattern
  try {
    const result = await listNotesTool.execute({
      folder: '',
      pattern: 'functional-test-*.md',
      recursive: true,
    });
    logTest('Execute list_notes tool (with pattern)', true, undefined, {
      matchedNotes: result.notes.length,
      matchesTestNote: result.notes.some(n => n.path === testNotePath),
    });
  } catch (error) {
    logTest('Execute list_notes tool (with pattern)', false, String(error));
  }

  // 8h. Test search_notes tool
  try {
    const result = await searchNotesTool.execute({
      query: 'Functional Test',
      caseSensitive: false,
      contextLines: 1,
      limit: 5,
    });
    logTest('Execute search_notes tool', true, undefined, {
      totalMatches: result.totalMatches,
      searchedFiles: result.searchedFiles,
      hasResults: result.results.length > 0,
    });
  } catch (error) {
    logTest('Execute search_notes tool', false, String(error));
  }

  // 8i. Test search_notes with regex
  try {
    const result = await searchNotesTool.execute({
      query: 'test|appended',
      useRegex: true,
      caseSensitive: false,
      limit: 10,
    });
    logTest('Execute search_notes tool (with regex)', true, undefined, {
      totalMatches: result.totalMatches,
      hasResults: result.results.length > 0,
    });
  } catch (error) {
    logTest('Execute search_notes tool (with regex)', false, String(error));
  }

  // 9. Test Error Handling
  console.log();
  console.log('🚨 Testing Error Handling...');
  
  // Test read_note errors
  try {
    await readNoteTool.execute({ path: 'non-existent-file-12345.md' });
    logTest('Handle missing file error (read_note)', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isCorrectError = error.type === 'FILE_NOT_FOUND';
    logTest('Handle missing file error (read_note)', isCorrectError, undefined, {
      errorType: error.type,
      message: error.message,
      hasSuggestedAction: !!error.details?.suggestedAction,
    });
  }

  try {
    await readNoteTool.execute({ path: '../../../etc/passwd' });
    logTest('Handle path traversal attempt', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isCorrectError = error.type === 'INVALID_PATH';
    logTest('Handle path traversal attempt', isCorrectError, undefined, {
      errorType: error.type,
      message: error.message,
    });
  }

  try {
    await readNoteTool.execute({ path: '' });
    logTest('Handle empty path validation', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isValidationError = error.message?.includes('Path is required') ||
                              error.message?.includes('String must contain at least 1');
    logTest('Handle empty path validation', isValidationError, undefined, {
      message: error.message,
    });
  }

  // Test append_note error (append to non-existent file)
  try {
    await appendNoteTool.execute({
      path: 'non-existent-note-for-append.md',
      content: 'This should fail',
    });
    logTest('Handle append to non-existent file', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isCorrectError = error.type === 'FILE_NOT_FOUND';
    logTest('Handle append to non-existent file', isCorrectError, undefined, {
      errorType: error.type,
    });
  }

  // Test search_notes with invalid regex
  try {
    await searchNotesTool.execute({
      query: '[invalid(regex',
      useRegex: true,
    });
    logTest('Handle invalid regex in search', false, 'Expected error was not thrown');
  } catch (error: any) {
    const isCorrectError = error.message?.includes('Invalid regex') || error.message?.includes('regex');
    logTest('Handle invalid regex in search', isCorrectError, undefined, {
      message: error.message,
    });
  }

  // 10. Cleanup test file
  console.log();
  console.log('🧹 Cleaning up...');
  try {
    await client.deleteFile(testNotePath);
    logTest('Delete test note', true, undefined, {
      path: testNotePath,
    });
  } catch (error) {
    logTest('Delete test note', false, String(error));
  }

  // 11. Summary
  console.log();
  console.log('='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`Total Tests: ${total}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ❌`);
  console.log(`Pass Rate: ${passRate}%`);
  console.log();

  if (failed > 0) {
    console.log('Failed Tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    console.log();
    process.exit(1);
  } else {
    console.log('🎉 All functional tests passed!');
    console.log();
    console.log('✨ The Obsidian MCP Server is ready to use!');
    console.log();
    console.log('Next steps:');
    console.log('  1. Test with MCP Inspector: npx @modelcontextprotocol/inspector npm run dev');
    console.log('  2. Configure in Claude Desktop (see USAGE.md)');
    console.log('  3. Start using with Claude!');
    console.log();
  }
}

main().catch((error) => {
  console.error();
  console.error('❌ Fatal error during functional testing:');
  console.error(error);
  console.error();
  process.exit(1);
});
