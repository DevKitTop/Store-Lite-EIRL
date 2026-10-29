export function isSchemaDriftError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;
  const cause = err.cause as Record<string, unknown> | undefined;

  const code = err.code ?? cause?.code;
  if (code === '42703') return true;

  const message = [err.message, cause?.message, err.detail, cause?.detail]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  if (/column\s+["']?\w+["']?\s+does not exist/i.test(message)) return true;
  if (/relation\s+["']?\w+["']?\s+does not exist/i.test(message)) return true;
  if (/type\s+["']?\w+["']?\s+does not exist/i.test(message)) return true;
  if (/function\s+["']?\w+["']?\s+does not exist/i.test(message)) return true;

  return false;
}

export function getSchemaDriftSummary(error: unknown): string | null {
  if (!isSchemaDriftError(error)) return null;
  const err = error as Record<string, unknown>;
  const cause = err.cause as Record<string, unknown> | undefined;
  const message = (err.message ?? cause?.message) as string | undefined;
  return message ?? 'Schema drift detected';
}

export function isAppErrorWithSchemaDrift(error: unknown): boolean {
  if (isSchemaDriftError(error)) return true;
  const err = error as Record<string, unknown>;
  if (err && typeof err === 'object' && 'name' in err && err.name === 'AppError') {
    const cause = err.cause;
    return isSchemaDriftError(cause);
  }
  return false;
}
