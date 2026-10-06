import { randomBytes } from 'node:crypto';

/**
 * Order number contract for `payments.order_number` (W-P4).
 *
 * The order number is the only handle that reaches a payments row without a
 * DNI check, so its shape is a security property, not a formatting preference:
 *
 * - **Not derivable from the clock.** No wall-clock input is read here. A
 *   purchase window plus an assumed suffix length would otherwise collapse the
 *   candidate space to something enumerable.
 * - **Structurally disjoint from the legacy shape.** The legacy values in DEV
 *   are `ORD-` plus 8 characters; a 12-character suffix makes the two sets
 *   impossible to confuse under the anchored pattern below.
 * - **Filename-safe.** The ticket PNG is named after the order number and is
 *   uploaded with `upsert: true`, so any character outside the sanitizer's
 *   allowed set would collapse two distinct order numbers onto one object.
 */

/**
 * Pinned by spec requirement P4-6: the single validator shared by the legacy
 * 8-character values and the generated 12-character ones. The character class
 * is a superset of the hex alphabet the generator emits, which is what makes
 * `sanitizeTicketFileName` a no-op for legal input.
 *
 * Deliberately has no `g`/`y` flag: a stateful regex would return alternating
 * results across consecutive `.test()` calls.
 */
export const ORDER_NUMBER_PATTERN = /^ORD-[A-Za-z0-9_-]{8,20}$/;

/**
 * 6 random bytes render as exactly 12 hex nibbles, i.e. 48 bits.
 *
 * The "6 chars vs 6 bytes" trap is why this is not a modulo reduction over an
 * alphabet: 6 base-36 characters would be only ~31 bits, and 6 hex characters
 * only 24. Hex-encoding the raw bytes maps one byte to exactly two nibbles, so
 * there is no `%` bias to correct and no rejection loop to run.
 */
const RANDOM_BYTE_LENGTH = 6;

/** Characters the ticket storage filename collapses to `_` (route.ts:264). */
const UNSAFE_FILENAME_CHARACTERS = /[^a-zA-Z0-9_-]/g;

/**
 * Generate a server-side order number.
 *
 * @returns `ORD-` followed by 12 uppercase hex characters (16 chars total,
 * 48 bits of entropy, uniform).
 *
 * @example
 * const orderNumber = generateOrderNumber();
 * // "ORD-3F9A2B1C4D5E"
 */
export function generateOrderNumber(): string {
  return `ORD-${randomBytes(RANDOM_BYTE_LENGTH).toString('hex').toUpperCase()}`;
}

/**
 * Derive the ticket storage filename from an order number.
 *
 * Mirrors the inline sanitizer in `app/api/ticket/generate/route.ts`. It is
 * exported so the injectivity property can be proven here, in isolation,
 * before that route is rewired to call it.
 *
 * For any value satisfying {@link ORDER_NUMBER_PATTERN} this is the identity:
 * the order number is already a legal filename component, so no character
 * collapses and two distinct order numbers can never resolve to one object.
 *
 * @param orderNumber - The order number to sanitize
 * @returns The filename-safe form
 */
export function sanitizeTicketFileName(orderNumber: string): string {
  return orderNumber.replace(UNSAFE_FILENAME_CHARACTERS, '_');
}
