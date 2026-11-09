/**
 * Structured Logger
 *
 * Bridges Sentry Logs + console with PII scrubbing.
 * - Dual-writes: Sentry.logger.* + console.*
 * - Level filtering: debug dropped in production
 * - PII scrubbing: emails/phones redacted before output
 */

/* eslint-disable no-console, security/detect-object-injection */

import { logger as sentryLogger } from '@sentry/nextjs';

import { scrubPII } from './piiScrubber';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function formatConsole(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (isProduction()) {
    console[level](
      JSON.stringify({
        level,
        message,
        data,
        timestamp: new Date().toISOString(),
      }),
    );
  } else {
    console[level](`[${level.toUpperCase()}] ${message}`, data ?? '');
  }
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // Production: drop debug messages entirely
  if (isProduction() && level === 'debug') return;

  const cleanMessage = scrubPII(message);
  const cleanData = data ? scrubPII(data) : undefined;

  try {
    (sentryLogger[level] as (msg: string, d?: Record<string, unknown>) => void)(
      cleanMessage,
      cleanData,
    );
  } catch {
    // Sentry unavailable — console fallback still works
  }

  formatConsole(level, cleanMessage, cleanData);
}

/**
 * Normalises a thrown value for the log payload: an Error becomes its message,
 * anything else (an API response body, a string) is kept as-is. Written as a
 * helper rather than an inline ternary because each ternary adds to the
 * cognitive complexity of the surrounding function.
 */
export function toErrorDetail(error: unknown): unknown {
  if (error instanceof Error) {
    return error.message;
  }

  return error;
}

export const logger: Logger = {
  debug: (message, data) => log('debug', message, data),
  info: (message, data) => log('info', message, data),
  warn: (message, data) => log('warn', message, data),
  error: (message, data) => log('error', message, data),
};
