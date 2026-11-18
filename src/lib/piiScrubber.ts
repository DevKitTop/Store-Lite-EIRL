/**
 * PII Scrubber
 *
 * Regex-based removal of emails and phone numbers from
 * log messages and event properties before sending to
 * Sentry or PostHog. NEVER send real PII to observability tools.
 */

/* eslint-disable security/detect-object-injection, security/detect-unsafe-regex, sonarjs/regex-complexity */

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-!#$&'*/=?^`{|}~]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}/g;

/**
 * UUIDs are identifiers, not PII. They must survive scrubbing intact.
 *
 * The PHONE_REGEX above matches runs of 6-8 digits, so a UUID whose hex groups
 * happen to be all digits (a common case: `...-446655440001`) was being mangled
 * into `...-44665[REDACTED_PHONE]`. That corrupted the businessId/productId in
 * every log line that carried an identifier, which made business alerts
 * (oversell, B1) unusable. We swap UUIDs out for placeholders, scrub the rest,
 * then restore them verbatim.
 */
const UUID_REGEX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const UUID_PLACEHOLDER_REGEX = /<<<UUID_(\d+)>>>/g;

function scrubString(text: string): string {
  // Redact emails FIRST. A UUID can appear inside an email's local part
  // (`<uuid>@example.com`). If the UUID were swapped for a placeholder first,
  // the placeholder's characters (`<`, `>`) are not local-part legal, so
  // EMAIL_REGEX would stop matching and the address would leak verbatim.
  // Redacting the whole address first removes that failure mode.
  const withoutEmails = text.replace(EMAIL_REGEX, '[REDACTED_EMAIL]');

  const protectedIds: string[] = [];
  const withPlaceholders = withoutEmails.replace(UUID_REGEX, (match) => {
    protectedIds.push(match);
    return `<<<UUID_${protectedIds.length - 1}>>>`;
  });

  const scrubbed = withPlaceholders.replace(PHONE_REGEX, '[REDACTED_PHONE]');

  return scrubbed.replace(UUID_PLACEHOLDER_REGEX, (match, index: string) => {
    const id = protectedIds[Number(index)];
    // `id ?? match` preserves a literal placeholder-looking token the caller
    // actually wrote instead of deleting it.
    return id ?? match;
  });
}

function scrubObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = scrubString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = scrubObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Scrub PII from a string or object.
 * - Strings: emails and phones are replaced with [REDACTED_*]
 * - Objects: recursively scrubs all string values
 * - Other types: returned unchanged
 */
export function scrubPII<T>(input: T): T {
  if (typeof input === 'string') return scrubString(input) as T;
  if (typeof input === 'object' && input !== null && !Array.isArray(input))
    return scrubObject(input as Record<string, unknown>) as T;
  return input;
}
