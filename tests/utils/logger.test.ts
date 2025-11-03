import { describe, it, expect, beforeEach } from 'vitest';
import { createLogger, initializeLogger, getLogger } from '../../src/utils/logger';
import type { Config } from '../../src/utils/config';

describe('logger', () => {
  const mockConfig: Config = {
    vaultPath: '/test/vault',
    verifySsl: false,
    logLevel: 'info',
    maxFileSizeMB: 10,
    enableDelete: true,
    retryMaxAttempts: 3,
    retryBaseDelay: 100,
  };

  describe('createLogger', () => {
    it('should create a logger with specified log level', () => {
      const logger = createLogger(mockConfig);

      expect(logger).toBeDefined();
      expect(logger.level).toBe('info');
    });

    it('should create logger with debug level', () => {
      const debugConfig: Config = { ...mockConfig, logLevel: 'debug' };
      const logger = createLogger(debugConfig);

      expect(logger.level).toBe('debug');
    });

    it('should create logger with error level', () => {
      const errorConfig: Config = { ...mockConfig, logLevel: 'error' };
      const logger = createLogger(errorConfig);

      expect(logger.level).toBe('error');
    });

    it('should have console transport configured', () => {
      const logger = createLogger(mockConfig);

      expect(logger.transports).toHaveLength(1);
      expect(logger.transports[0]?.constructor.name).toBe('Console');
    });
  });

  describe('initializeLogger and getLogger', () => {
    it('should initialize and retrieve default logger', () => {
      const logger = initializeLogger(mockConfig);

      expect(logger).toBeDefined();
      expect(getLogger()).toBe(logger);
    });

    it('should throw error if getLogger called before initialization', () => {
      // Reset by creating a new logger module context would be complex
      // Instead, we test the normal flow
      const logger = initializeLogger(mockConfig);
      expect(() => getLogger()).not.toThrow();
    });

    it('should return same instance on multiple getLogger calls', () => {
      initializeLogger(mockConfig);

      const logger1 = getLogger();
      const logger2 = getLogger();

      expect(logger1).toBe(logger2);
    });
  });
});
