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

/** Buckets that hold receipts we are allowed to sign. */
const SIGNABLE_BUCKETS = ['tickets', 'tickets_plans'] as const;
export type TicketBucket = (typeof SIGNABLE_BUCKETS)[number];

export interface TicketLocation {
  bucket: TicketBucket;
  path: string;
}

const OBJECT_MARKER = '/storage/v1/object/';

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

function isSignableBucket(value: string): value is TicketBucket {
  return (SIGNABLE_BUCKETS as readonly string[]).includes(value);
}

function withBucket(bucket: TicketBucket, path: string | null): TicketLocation | null {
  return path === null ? null : { bucket, path };
}

/**
 * Resolves the bucket and object path of a stored receipt, whatever shape the
 * row holds: an absolute public URL, a previously signed URL, or a bare path.
 * Returns null for anything that is not a receipt in one of our buckets.
 */
export function extractTicketLocation(value: string | null | undefined): TicketLocation | null {
  if (typeof value !== 'string') return null;

  const raw = value.trim();
  if (!raw) return null;

  const marker = raw.indexOf(OBJECT_MARKER);
  if (marker !== -1) {
    const [access, bucket, ...rest] = stripQuery(raw.slice(marker + OBJECT_MARKER.length)).split(
      '/',
    );
    if (access !== 'public' && access !== 'sign') return null;
    if (!isSignableBucket(bucket)) return null;
    const decoded = decode(rest.join('/'));
    return withBucket(bucket, decoded === null ? null : normalize(decoded));
  }

  // Any other absolute URL belongs to another host or another storage.
  if (raw.includes('://')) return null;

  // A bare relative path predates the bucket split, so it is a `tickets` object.
  const decoded = decode(stripQuery(raw));
  return withBucket('tickets', decoded === null ? null : normalize(decoded));
}

/** Object path alone, for callers that already know which bucket it is in. */
export function extractTicketPath(value: string | null | undefined): string | null {
  return extractTicketLocation(value)?.path ?? null;
}
