#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getConfig, getOperationMode } from './utils/config.js';
import { initializeLogger } from './utils/logger.js';
import { RetryManager } from './utils/retry.js';
import { ObsidianClient } from './obsidian/client.js';
import { ReadNoteTool } from './tools/readNote.js';
import { WriteNoteTool } from './tools/writeNote.js';
import { AppendNoteTool } from './tools/appendNote.js';
import { ListNotesTool } from './tools/listNotes.js';
import { SearchNotesTool } from './tools/searchNotes.js';
import { GetDailyNoteTool } from './tools/getDailyNote.js';
import { AppendToDailyTool } from './tools/appendToDaily.js';
import { UpdateFrontmatterTool } from './tools/updateFrontmatter.js';
import { GetTagsTool } from './tools/getTags.js';
import { ApplyTemplateTool } from './tools/applyTemplate.js';
import { DeleteNoteTool } from './tools/deleteNote.js';
import { GetActiveFileTool } from './tools/getActiveFile.js';
import { EditNoteTool } from './tools/editNote.js';
import { UpdateSectionTool } from './tools/updateSection.js';
import { formatError } from './obsidian/errorHandler.js';
import type { ObsidianError } from './types/obsidian.js';
import type { BaseTool } from './tools/base.js';

/**
 * Main MCP Server for Obsidian
 *
 * Provides hybrid filesystem + API access to Obsidian vault notes via the Model Context Protocol.
 *
 * Architecture:
 * - ObsidianClient: Hybrid coordinator (filesystem + REST API)
 * - FileSystemClient: Direct file I/O operations
 * - RestApiClient: Obsidian Local REST API integration
 * - Tools: MCP tool implementations (read_note, get_daily_note, etc.)
 * - RetryManager: Automatic retry for transient errors
 * - Error Handler: Categorized error responses
 *
 * Operation Modes:
 * - Filesystem: Direct file access only (no API configured)
 * - Hybrid: API-first with filesystem fallback (optimal for daily notes & plugins)
 */

async function main() {
  // 1. Initialize configuration and logging
  let config;
  let logger;

  try {
    config = getConfig();
    logger = initializeLogger(config);
  } catch (error) {
    console.error('Failed to initialize configuration:', error);
    process.exit(1);
  }

  const mode = getOperationMode(config);

  logger.info('Starting Obsidian MCP Server', {
    version: '0.1.0',
    mode,
    vaultPath: config.vaultPath,
    logLevel: config.logLevel,
    maxFileSizeMB: config.maxFileSizeMB,
    apiConfigured: !!config.apiUrl,
  });

  // 2. Initialize retry manager and hybrid client
  const retryManager = new RetryManager(
    {
      maxAttempts: config.retryMaxAttempts,
      baseDelay: config.retryBaseDelay,
    },
    logger
  );

  const client = new ObsidianClient(config, logger, retryManager);

  // 3. Initialize the client (checks API availability)
  await client.initialize();

  logger.info('Client initialized', {
    mode: client.getMode(),
  });

  // 4. Initialize tools
  const tools: BaseTool<any, any>[] = [
    new ReadNoteTool(client, logger),
    new WriteNoteTool(client, logger),
    new AppendNoteTool(client, logger),
    new EditNoteTool(client, logger),
    new UpdateSectionTool(client, logger),
    new ListNotesTool(client, logger),
    new SearchNotesTool(client, logger),
    new GetDailyNoteTool(client, logger),
    new AppendToDailyTool(client, logger),
    new UpdateFrontmatterTool(client, logger),
    new GetTagsTool(client, logger),
    new ApplyTemplateTool(client, logger),
    new DeleteNoteTool(client, logger),
    new GetActiveFileTool(client, logger),
  ];

  logger.info(`Registered ${tools.length} tools`, {
    tools: tools.map(t => t.name),
  });

  // 5. Create and configure MCP server
  const server = new Server(
    {
      name: 'obsidian-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // 6. Register tool list handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug('Handling tools/list request');

    return {
      tools: tools.map(tool => tool.toMCPTool()),
    };
  });

  // 7. Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info('Tool call requested', { tool: name, args });

    // Find the requested tool
    const tool = tools.find(t => t.name === name);

    if (!tool) {
      logger.warn('Unknown tool requested', { tool: name });
      throw new Error(`Unknown tool: ${name}`);
    }

    try {
      // Execute the tool
      const result = await tool.execute(args);

      logger.info('Tool call completed successfully', { tool: name });

      // Return result as MCP content
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result),
          },
        ],
      };
    } catch (error) {
      logger.error('Tool call failed', { tool: name, error });

      // Format error for user
      const formattedError = isObsidianError(error)
        ? formatError(error)
        : error instanceof Error
          ? error.message
          : String(error);

      return {
        content: [
          {
            type: 'text' as const,
            text: `Error: ${formattedError}`,
          },
        ],
        isError: true,
      };
    }
  });

  // 8. Error handlers
  server.onerror = (error) => {
    logger.error('Server error', { error });
  };

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    await server.close();
    process.exit(0);
  });

  // 9. Start server with stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Obsidian MCP Server started successfully', {
    transport: 'stdio',
    tools: tools.length,
  });
}

/**
 * Type guard for ObsidianError
 */
function isObsidianError(error: unknown): error is ObsidianError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    'message' in error
  );
}

// Start the server
main().catch((error) => {
  console.error('Fatal error starting server:', error);
  process.exit(1);
});
