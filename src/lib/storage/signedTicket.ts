/**
 * Signs receipt objects stored in the private `tickets` bucket.
 *
 * The bucket is private: the public object endpoint refuses to serve it. Every
 * legitimate viewer (seller dashboard, customer order page) reads through a
 * short-lived signed URL generated here, on the server, with the service role.
 */

import { env } from '@/config/env';
import { createClient } from '@supabase/supabase-js';
import { extractTicketPath } from './ticketImage';

const BUCKET = 'tickets';
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
  const path = extractTicketPath(storedValue);
  if (!path) return null;

  try {
    const { data, error } = await adminClient()
      .storage.from(BUCKET)
      .createSignedUrl(path, ttlSeconds);
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
 * Batch variant: signs every value in one storage call.
 * Values that do not resolve keep a null in the same index.
 */
export async function getSignedTicketUrls(
  values: (string | null | undefined)[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<(string | null)[]> {
  const paths = values.map((value) => extractTicketPath(value));
  const result: (string | null)[] = paths.map(() => null);

  const signableIndexes = paths
    .map((path, index) => ({ path, index }))
    .filter((entry): entry is { path: string; index: number } => entry.path !== null);

  if (signableIndexes.length === 0) return result;

  try {
    const { data, error } = await adminClient()
      .storage.from(BUCKET)
      .createSignedUrls(
        signableIndexes.map((entry) => entry.path),
        ttlSeconds,
      );

    if (error || !data) {
      console.error('[signedTicket] Batch signing failed:', error?.message ?? 'empty result');
      return result;
    }

    // Storage answers in the same order it was asked, so position is the map.
    // Matching by path instead would collapse two orders that share a file.
    data.forEach((item, position) => {
      const target = signableIndexes.at(position);
      if (target && item.signedUrl) result[target.index] = item.signedUrl;
    });
  } catch (error) {
    console.error(
      '[signedTicket] Batch signing threw:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return result;
}
