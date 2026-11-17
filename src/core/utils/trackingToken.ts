/**
 * Generate a readable tracking token for order tracking URLs.
 *
 * Uses 8-character alphanumeric string excluding visually
 * confusing characters (I, l, 1, O, 0) for easy reading
 * and dictation over the phone.
 *
 * Entropy: 32^8 = 1.1 trillion combinations (40 bits). That is what protects
 * the order: access is granted by presenting this token, or by a session that
 * owns the business. The old "30^8 ≈ 6.5 billion" figure was off by ~170x and
 * understated the real strength.
 *
 * @returns An 8-character alphanumeric string
 *
 * @example
 * const token = generateTrackingToken();
 * // "H4K9P2M7"
 */
export function generateTrackingToken(): string {
  // Characters excluding: I, l, 1, O, 0 (visually confusing)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const length = 8;
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Validate if a string looks like a valid tracking token.
 * Accepts both formats for backward compatibility:
 * - New: 8-character alphanumeric (e.g. "H4K9P2M7")
 * - Legacy: 96-character hex (3 UUIDs without hyphens)
 *
 * @param token - The token to validate
 * @returns true if it matches either format
 */
export function isValidTrackingToken(token: string): boolean {
  // New format: 8 alphanumeric chars (excluding I, l, 1, O, 0)
  if (/^[A-HJ-NP-Z2-9]{8}$/i.test(token)) return true;
  // Legacy format: 96 hex characters (3 UUIDs without hyphens)
  if (/^[0-9a-f]{96}$/i.test(token)) return true;
  return false;
}
