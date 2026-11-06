/**
 * Signs receipt objects stored in the private receipt buckets (`tickets` for
 * order receipts, `tickets_plans` for plan receipts).
 *
 * Those buckets are private: the public object endpoint refuses to serve them.
 * Every legitimate viewer (seller dashboard, customer order page, email link)
 * reads through a short-lived signed URL generated here, on the server, with
 * the service role.
 */

import { env } from '@/config/env';
import { createClient } from '@supabase/supabase-js';
import { extractTicketLocation, type TicketBucket } from './ticketImage';

const DEFAULT_TTL_SECONDS = 60 * 60;

function adminClient() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Returns a signed URL for a stored value, or null when it cannot be signed. */
export async function getSignedTicketUrl(
  storedValue: string | null | undefined,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  const location = extractTicketLocation(storedValue);
  if (!location) return null;

  try {
    const { data, error } = await adminClient()
      .storage.from(location.bucket)
      .createSignedUrl(location.path, ttlSeconds);
    if (error || !data?.signedUrl) {
      console.error('[signedTicket] Could not sign:', error?.message ?? 'empty result');
      return null;
    }
    return data.signedUrl;
  } catch (error) {
    console.error(
      '[signedTicket] Signing failed:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Batch variant: signs every value, one storage call per bucket.
 * Values that do not resolve keep a null in the same index.
 */
export async function getSignedTicketUrls(
  values: (string | null | undefined)[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<(string | null)[]> {
  const result: (string | null)[] = values.map(() => null);
  const groups = new Map<TicketBucket, { path: string; index: number }[]>();

  values.forEach((value, index) => {
    const location = extractTicketLocation(value);
    if (!location) return;

    const group = groups.get(location.bucket) ?? [];
    group.push({ path: location.path, index });
    groups.set(location.bucket, group);
  });

  if (groups.size === 0) return result;

  await Promise.all(
    [...groups].map(async ([bucket, entries]) => {
      try {
        const { data, error } = await adminClient()
          .storage.from(bucket)
          .createSignedUrls(
            entries.map((entry) => entry.path),
            ttlSeconds,
          );

        if (error || !data) {
          console.error('[signedTicket] Batch signing failed:', error?.message ?? 'empty result');
          return;
        }

        // Storage answers in the same order it was asked, so position is the map.
        // Matching by path instead would collapse two orders that share a file.
        data.forEach((item, position) => {
          const target = entries.at(position);
          if (target && item.signedUrl) result[target.index] = item.signedUrl;
        });
      } catch (error) {
        console.error(
          '[signedTicket] Batch signing threw:',
          error instanceof Error ? error.message : String(error),
        );
      }
    }),
  );

  return result;
}
