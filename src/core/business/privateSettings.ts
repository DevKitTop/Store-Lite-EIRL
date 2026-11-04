import { db } from '@/core/database/client';
import type { PublicBusiness } from '@/types/business';
import { sql } from 'drizzle-orm';
import { resolvePublicBusinessSlug } from './publicSlug';

/**
 * Raw shape returned by `public.business_private_settings`.
 *
 * The function returns zero rows unless the given user is the owner or a team
 * member of the business, so "not a member" and "no such business" look the
 * same from here — deliberately.
 */
interface PrivateSettingsRow {
  id: string;
  slug: string;
  legal_rep_name: string | null;
  legal_rep_role: string | null;
  legal_rep_phone: string | null;
  legal_rep_email: string | null;
  culqi_public_key: string | null;
  culqi_secret_key: string | null;
  preferences: Record<string, unknown> | null;
  theme_mode: 'light' | 'dark' | null;
}

/**
 * The fields a business keeps for itself and for the people who run it:
 * the legal representative block and the payment credentials.
 */
export interface BusinessPrivateSettings {
  legalRepName: string | null;
  legalRepRole: string | null;
  legalRepPhone: string | null;
  legalRepEmail: string | null;
  culqiPublicKey: string | null;
  culqiSecretKey: string | null;
  preferences: Record<string, unknown> | null;
  themeMode: 'light' | 'dark';
}

export interface ResolvedSettingsBusiness {
  business: PublicBusiness;
  privateSettings: BusinessPrivateSettings;
  canonicalSlug: string;
  requestedSlug: string;
  matchedAlias: boolean;
}

function toPrivateSettings(row: PrivateSettingsRow): BusinessPrivateSettings {
  return {
    legalRepName: row.legal_rep_name,
    legalRepRole: row.legal_rep_role,
    legalRepPhone: row.legal_rep_phone,
    legalRepEmail: row.legal_rep_email,
    culqiPublicKey: row.culqi_public_key,
    culqiSecretKey: row.culqi_secret_key,
    preferences: row.preferences,
    themeMode: row.theme_mode ?? 'light',
  };
}

/**
 * Resolve a business for its settings screen: the public projection plus the
 * private fields, and only for a user who belongs to it.
 *
 * The membership check lives in the database function, not in a comparison
 * here, so a caller that forgets a role check still gets no private fields.
 */
export async function resolveSettingsBusiness(
  slug: string,
  userId: string,
): Promise<ResolvedSettingsBusiness | null> {
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return null;
  }

  const rows = (await db.execute(sql`
    select * from public.business_private_settings(${slug}, ${userId}::uuid)
  `)) as unknown as PrivateSettingsRow[];

  const row = rows.at(0);

  if (!row) {
    return null;
  }

  return {
    business,
    privateSettings: toPrivateSettings(row),
    canonicalSlug: business.slug,
    requestedSlug: slug,
    matchedAlias: business.slug !== slug,
  };
}
