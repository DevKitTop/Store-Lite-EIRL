/**
 * Resolves the object path of a receipt stored in the private `tickets` bucket.
 *
 * Before the bucket was made private, `payments.ticket_image_url` and
 * `payments.ticket_url` stored absolute public URLs
 * (`.../storage/v1/object/public/tickets/<path>`). Those rows are not rewritten:
 * the path is recovered from whatever shape the value has, so old and new rows
 * resolve through the same call.
 *
 * The bucket itself is private now, so the returned path is only useful to a
 * caller that can sign it (see `signedTicket.ts`).
 */

const PUBLIC_PREFIX = '/storage/v1/object/public/tickets/';
const SIGNED_PREFIX = '/storage/v1/object/sign/tickets/';

function stripQuery(value: string): string {
  const index = value.search(/[?#]/);
  return index === -1 ? value : value.slice(0, index);
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Rejects anything that is not a plain, relative object path inside the bucket. */
function normalize(path: string): string | null {
  if (!path) return null;
  if (path.startsWith('/')) return null;
  if (path.includes('..')) return null;
  if (path.split('/').some((segment) => segment.length === 0)) return null;
  return path;
}

export function extractTicketPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  const publicIndex = raw.indexOf(PUBLIC_PREFIX);
  if (publicIndex !== -1) {
    const decoded = decode(stripQuery(raw.slice(publicIndex + PUBLIC_PREFIX.length)));
    return decoded === null ? null : normalize(decoded);
  }

  const signedIndex = raw.indexOf(SIGNED_PREFIX);
  if (signedIndex !== -1) {
    const decoded = decode(stripQuery(raw.slice(signedIndex + SIGNED_PREFIX.length)));
    return decoded === null ? null : normalize(decoded);
  }

  // Any absolute URL that is not one of the shapes above belongs to another
  // bucket, another host, or no storage at all.
  if (raw.includes('://')) return null;

  const decoded = decode(stripQuery(raw));
  return decoded === null ? null : normalize(decoded);
}
