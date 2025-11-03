import winston from 'winston';
import type { Config } from './config.js';

/**
 * Create a Winston logger instance with appropriate configuration
 */
export function createLogger(config: Config): winston.Logger {
  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${metaStr}`;
    })
  );

  return winston.createLogger({
    level: config.logLevel,
    format: logFormat,
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
        format: winston.format.combine(winston.format.colorize(), logFormat),
      }),
    ],
  });
}

/**
 * Default logger instance (will be initialized with config)
 */
let defaultLogger: winston.Logger | null = null;

/**
 * Initialize the default logger
 */
export function initializeLogger(config: Config): winston.Logger {
  defaultLogger = createLogger(config);
  return defaultLogger;
}

/**
 * Get the default logger instance
 */
export function getLogger(): winston.Logger {
  if (!defaultLogger) {
    throw new Error('Logger not initialized. Call initializeLogger() first.');
  }
  return defaultLogger;
}
