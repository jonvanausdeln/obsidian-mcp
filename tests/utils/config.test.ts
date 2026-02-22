import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getConfig, getOperationMode, type Config } from '../../src/utils/config';
import { existsSync, statSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('config', () => {
  const originalEnv = process.env;
  let testVaultPath: string;

  beforeEach(() => {
    // Create a temporary test vault
    testVaultPath = join(tmpdir(), `obsidian-mcp-test-${Date.now()}`);
    mkdirSync(testVaultPath, { recursive: true });
    mkdirSync(join(testVaultPath, '.obsidian'), { recursive: true });

    // Reset environment
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Cleanup test vault
    if (existsSync(testVaultPath)) {
      rmSync(testVaultPath, { recursive: true, force: true });
    }

    // Restore environment
    process.env = originalEnv;
  });

  describe('getConfig', () => {
    it('should load minimal valid configuration', () => {
      process.env.OBSIDIAN_VAULT_PATH = testVaultPath;

      const config = getConfig();

      expect(config.vaultPath).toBe(testVaultPath);
      expect(config.logLevel).toBe('info');
      expect(config.maxFileSizeMB).toBe(10);
      expect(config.enableDelete).toBe(true);
      expect(config.retryMaxAttempts).toBe(3);
      expect(config.retryBaseDelay).toBe(100);
    });

    it('should load full configuration with all options', () => {
      process.env.OBSIDIAN_VAULT_PATH = testVaultPath;
      process.env.OBSIDIAN_API_URL = 'http://127.0.0.1:27123';
      process.env.OBSIDIAN_API_KEY = 'test-key';
      process.env.OBSIDIAN_VERIFY_SSL = 'true';
      process.env.LOG_LEVEL = 'debug';
      process.env.MAX_FILE_SIZE_MB = '20';
      process.env.ENABLE_DELETE = 'false';
      process.env.RETRY_MAX_ATTEMPTS = '5';
      process.env.RETRY_BASE_DELAY = '200';

      const config = getConfig();

      expect(config.vaultPath).toBe(testVaultPath);
      expect(config.apiUrl).toBe('http://127.0.0.1:27123');
      expect(config.apiKey).toBe('test-key');
      expect(config.verifySsl).toBe(true);
      expect(config.logLevel).toBe('debug');
      expect(config.maxFileSizeMB).toBe(20);
      expect(config.enableDelete).toBe(false);
      expect(config.retryMaxAttempts).toBe(5);
      expect(config.retryBaseDelay).toBe(200);
    });

    it('should throw error if OBSIDIAN_VAULT_PATH is missing', () => {
      delete process.env.OBSIDIAN_VAULT_PATH;
      expect(() => getConfig()).toThrow('Configuration validation failed');
    });

    it('should throw error if vault path does not exist', () => {
      process.env.OBSIDIAN_VAULT_PATH = '/nonexistent/path';

      expect(() => getConfig()).toThrow('Vault path does not exist');
    });

    it('should throw error if vault path is a file not directory', () => {
      const filePath = join(testVaultPath, 'test.md');
      mkdirSync(testVaultPath, { recursive: true });
      require('fs').writeFileSync(filePath, 'test');

      process.env.OBSIDIAN_VAULT_PATH = filePath;

      expect(() => getConfig()).toThrow('Vault path is not a directory');
    });

    it('should warn if .obsidian folder is missing', () => {
      const vaultWithoutObsidian = join(tmpdir(), `vault-no-obsidian-${Date.now()}`);
      mkdirSync(vaultWithoutObsidian, { recursive: true });

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      process.env.OBSIDIAN_VAULT_PATH = vaultWithoutObsidian;

      const config = getConfig();

      expect(config.vaultPath).toBe(vaultWithoutObsidian);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('.obsidian folder not found')
      );

      consoleSpy.mockRestore();
      rmSync(vaultWithoutObsidian, { recursive: true, force: true });
    });

    it('should validate log level enum', () => {
      process.env.OBSIDIAN_VAULT_PATH = testVaultPath;
      process.env.LOG_LEVEL = 'invalid';

      expect(() => getConfig()).toThrow();
    });

    it('should validate maxFileSizeMB is positive', () => {
      process.env.OBSIDIAN_VAULT_PATH = testVaultPath;
      process.env.MAX_FILE_SIZE_MB = '-5';

      expect(() => getConfig()).toThrow();
    });

    it('should validate retryMaxAttempts is positive integer', () => {
      process.env.OBSIDIAN_VAULT_PATH = testVaultPath;
      process.env.RETRY_MAX_ATTEMPTS = '0';

      expect(() => getConfig()).toThrow();
    });
  });

  describe('getOperationMode', () => {
    it('should return filesystem mode with only vault path', () => {
      const config: Config = {
        vaultPath: testVaultPath,
        verifySsl: false,
        logLevel: 'info',
        maxFileSizeMB: 10,
        enableDelete: true,
        retryMaxAttempts: 3,
        retryBaseDelay: 100,
      };

      expect(getOperationMode(config)).toBe('filesystem');
    });

    it('should return api mode with only API config', () => {
      const config: Config = {
        vaultPath: '',
        apiUrl: 'http://127.0.0.1:27123',
        apiKey: 'test-key',
        verifySsl: false,
        logLevel: 'info',
        maxFileSizeMB: 10,
        enableDelete: true,
        retryMaxAttempts: 3,
        retryBaseDelay: 100,
      };

      expect(getOperationMode(config)).toBe('api');
    });

    it('should return hybrid mode with both vault path and API config', () => {
      const config: Config = {
        vaultPath: testVaultPath,
        apiUrl: 'http://127.0.0.1:27123',
        apiKey: 'test-key',
        verifySsl: false,
        logLevel: 'info',
        maxFileSizeMB: 10,
        enableDelete: true,
        retryMaxAttempts: 3,
        retryBaseDelay: 100,
      };

      expect(getOperationMode(config)).toBe('hybrid');
    });

    it('should return filesystem mode if API URL missing', () => {
      const config: Config = {
        vaultPath: testVaultPath,
        apiKey: 'test-key',
        verifySsl: false,
        logLevel: 'info',
        maxFileSizeMB: 10,
        enableDelete: true,
        retryMaxAttempts: 3,
        retryBaseDelay: 100,
      };

      expect(getOperationMode(config)).toBe('filesystem');
    });

    it('should return filesystem mode if API key missing', () => {
      const config: Config = {
        vaultPath: testVaultPath,
        apiUrl: 'http://127.0.0.1:27123',
        verifySsl: false,
        logLevel: 'info',
        maxFileSizeMB: 10,
        enableDelete: true,
        retryMaxAttempts: 3,
        retryBaseDelay: 100,
      };

      expect(getOperationMode(config)).toBe('filesystem');
    });
  });
});
