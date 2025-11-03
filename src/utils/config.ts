import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import { existsSync, statSync } from 'fs';
import { resolve } from 'path';

// Load environment variables from .env file
// Suppress dotenv's stdout logging for MCP stdio compatibility
const originalLog = console.log;
console.log = () => {}; // Temporarily disable console.log
dotenvConfig();
console.log = originalLog; // Restore console.log

/**
 * Configuration schema using Zod for runtime validation
 */
const ConfigSchema = z.object({
  // Required - Vault path
  vaultPath: z.string().min(1, 'OBSIDIAN_VAULT_PATH is required'),

  // Optional - API mode (Phase 2)
  apiUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  verifySsl: z.boolean().default(false),

  // Optional - General settings
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  maxFileSizeMB: z.number().positive().default(10),
  enableDelete: z.boolean().default(true),

  // Optional - Retry settings
  retryMaxAttempts: z.number().int().positive().default(3),
  retryBaseDelay: z.number().int().positive().default(100),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Parse and validate configuration from environment variables
 */
function parseConfig(): Config {
  const rawConfig = {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH,
    apiUrl: process.env.OBSIDIAN_API_URL,
    apiKey: process.env.OBSIDIAN_API_KEY,
    verifySsl: process.env.OBSIDIAN_VERIFY_SSL === 'true',
    logLevel: process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
    maxFileSizeMB: process.env.MAX_FILE_SIZE_MB ? parseInt(process.env.MAX_FILE_SIZE_MB, 10) : undefined,
    enableDelete: process.env.ENABLE_DELETE !== 'false',
    retryMaxAttempts: process.env.RETRY_MAX_ATTEMPTS ? parseInt(process.env.RETRY_MAX_ATTEMPTS, 10) : undefined,
    retryBaseDelay: process.env.RETRY_BASE_DELAY ? parseInt(process.env.RETRY_BASE_DELAY, 10) : undefined,
  };

  return ConfigSchema.parse(rawConfig);
}

/**
 * Validate vault path exists and is accessible
 */
function validateVaultPath(vaultPath: string): void {
  const absolutePath = resolve(vaultPath);

  if (!existsSync(absolutePath)) {
    throw new Error(`Vault path does not exist: ${absolutePath}`);
  }

  const stats = statSync(absolutePath);
  if (!stats.isDirectory()) {
    throw new Error(`Vault path is not a directory: ${absolutePath}`);
  }

  // Warn if .obsidian folder not found (likely not a valid vault)
  const obsidianConfigPath = resolve(absolutePath, '.obsidian');
  if (!existsSync(obsidianConfigPath)) {
    console.warn(
      `Warning: .obsidian folder not found in vault path. This may not be a valid Obsidian vault: ${absolutePath}`
    );
  }
}

/**
 * Get validated configuration
 */
export function getConfig(): Config {
  try {
    const config = parseConfig();

    // Validate vault path
    validateVaultPath(config.vaultPath);

    // Resolve to absolute path
    config.vaultPath = resolve(config.vaultPath);

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Configuration validation failed:\n${messages}`);
    }
    throw error;
  }
}

/**
 * Get operation mode based on configuration
 */
export function getOperationMode(config: Config): 'filesystem' | 'api' | 'hybrid' {
  if (config.apiUrl && config.apiKey) {
    return config.vaultPath ? 'hybrid' : 'api';
  }
  return 'filesystem';
}
