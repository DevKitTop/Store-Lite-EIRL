import type { Permission } from '@/lib/permissions/definitions';

/**
 * Single denial message for every storefront customization write. Keeping it
 * beside the predicate means UI copy and server action failures cannot drift.
 */
export const STOREFRONT_CUSTOMIZATION_DENIED_MESSAGE =
  'Funcion disponible solo para planes con personalizacion de storefront.';

/**
 * Owners have every permission; members need the explicit storefront grant.
 */
export function hasStorefrontEditPermission({
  isOwner,
  permissions,
}: {
  isOwner: boolean;
  permissions: readonly Permission[];
}): boolean {
  return isOwner || permissions.includes('storefront.edit');
}

/**
 * One rule for all customization entry points: a valid editor identity AND an
 * eligible plan. Server actions call this after `requireAccessOnId`, which
 * already resolved the identity side; UI callers resolve both sides from the
 * same server-provided inputs.
 */
export function hasStorefrontCustomizationAccess({
  hasEditPermission,
  canCustomizeStorefrontPlan,
}: {
  hasEditPermission: boolean;
  canCustomizeStorefrontPlan: boolean;
}): boolean {
  return hasEditPermission && canCustomizeStorefrontPlan;
}
