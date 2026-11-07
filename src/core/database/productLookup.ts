import { products } from '@/core/database/schema';
import { eq, or, type SQL } from 'drizzle-orm';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value can safely be compared against a uuid column. */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Where clause for a product route parameter, which may be either a uuid or a
 * slug.
 *
 * Postgres raises 22P02 ("invalid input syntax for type uuid") when a uuid
 * column is compared against a slug, so the id branch is included only when
 * the value really is a uuid. Comparing both unconditionally broke every
 * product page reached by slug.
 */
export function productIdentifierWhere(productId: string): SQL | undefined {
  if (!isUuid(productId)) {
    return eq(products.slug, productId);
  }

  return or(eq(products.id, productId), eq(products.slug, productId));
}
