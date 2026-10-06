/**
 * WhatsApp template status normalization.
 *
 * YCloud (and Meta behind it) reports template review statuses in UPPERCASE
 * ('APPROVED' | 'REJECTED' | 'PENDING'). Our database, Drizzle types and all
 * downstream logic (badge mapping, `approved` filters, send guards) assume
 * lowercase. Every write path that persists a YCloud status MUST run it
 * through `normalizeMetaStatus` so stored values never drift to uppercase —
 * otherwise badges degrade to raw text and approved-template filters stop
 * matching after the first sync.
 */

export type MetaTemplateStatus = 'pending' | 'approved' | 'rejected';

const VALID_META_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'approved',
  'rejected',
]);

export function normalizeMetaStatus(value: string | null | undefined): MetaTemplateStatus {
  const normalized = value?.toLowerCase() ?? '';
  return (VALID_META_STATUSES.has(normalized) ? normalized : 'pending') as MetaTemplateStatus;
}