import pino from 'pino';

/**
 * Structured Logger for Spotlight.
 * Provides consistent JSON logging with contextual metadata.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
    },
  },
  base: {
    env: process.env.NODE_ENV || 'development',
    service: 'spotlight-api',
  },
});

/**
 * Helper to create a child logger with request context.
 * Use this in middleware or at the start of a request handler.
 */
export const createRequestContext = (context: Record<string, any>) => {
  return logger.child(context);
};

export type LogLevel = 'info' | 'error' | 'warn' | 'debug';

export const logEvent = (level: LogLevel, message: string, metadata?: Record<string, any>) => {
  logger[level]({ ...metadata }, message);
};
