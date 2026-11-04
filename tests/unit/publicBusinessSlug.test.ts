import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}));

import { resolvePublicBusinessRoute, resolvePublicBusinessSlug } from '@/core/business/publicSlug';

const ROW = {
  id: 'b1',
  slug: 'demo-store',
  name: 'Demo Store',
  logo_url: null,
  cover_image_url: null,
  description: 'A store',
  store_type: 'retail',
  departamento: 'Lima',
  provincia: 'Lima',
  distrito: 'Miraflores',
  email: 'hola@demo.test',
  person_type: 'empresa',
  verification_status: 'verified',
  geo_region: 'PE-LIM',
  geo_placename: 'Lima',
  tax_id: '20123456789',
  created_at: new Date('2024-01-01T00:00:00Z'),
  whatsapp_number: '+51999999999',
  address: 'Av. Siempre Viva 742',
  city: 'Lima',
  country: 'PE',
  social_links: null,
  hero_images: null,
  seo_title: 'Demo',
  seo_description: null,
  seo_keywords: ['tienda'],
  payment_flow: ['direct'],
  latitude: null,
  longitude: null,
  is_active: true,
};

describe('resolvePublicBusinessSlug', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('returns null when the projection has no row', async () => {
    execute.mockResolvedValue([]);

    await expect(resolvePublicBusinessSlug('missing')).resolves.toBeNull();
  });

  it('maps the projection to camelCase fields', async () => {
    execute.mockResolvedValue([ROW]);

    const business = await resolvePublicBusinessSlug('demo-store');

    expect(business).toMatchObject({
      id: 'b1',
      slug: 'demo-store',
      name: 'Demo Store',
      storeType: 'retail',
      whatsappNumber: '+51999999999',
      seoTitle: 'Demo',
      paymentFlow: ['direct'],
      isActive: true,
    });
  });

  it('preserves an inactive business so the caller can decide', async () => {
    execute.mockResolvedValue([{ ...ROW, is_active: false }]);

    const business = await resolvePublicBusinessSlug('demo-store');

    expect(business?.isActive).toBe(false);
  });

  it('exposes nothing beyond the public projection', async () => {
    execute.mockResolvedValue([ROW]);

    const business = await resolvePublicBusinessSlug('demo-store');

    expect(business).not.toBeNull();
    for (const forbidden of [
      'ownerId',
      'verificationData',
      'legalRepName',
      'legalRepRole',
      'legalRepEmail',
      'legalRepPhone',
      'penaltyDebt',
      'penaltyCount',
      'blacklisted',
      'blacklistedAt',
      'culqiBlocked',
      'deactivationReason',
      'deactivationDate',
      'appealStatus',
      'gracePeriodEndsAt',
    ]) {
      expect(business).not.toHaveProperty(forbidden);
    }
  });

  it('keeps the fields the storefront publishes on purpose', async () => {
    execute.mockResolvedValue([ROW]);

    const business = await resolvePublicBusinessSlug('demo-store');

    // The RUC and the store contact email are shown by the storefront today,
    // so leaving them out would be a regression rather than hardening.
    expect(business).toMatchObject({
      taxId: '20123456789',
      email: 'hola@demo.test',
      verificationStatus: 'verified',
      departamento: 'Lima',
      geoRegion: 'PE-LIM',
    });
  });
});

describe('resolvePublicBusinessRoute', () => {
  beforeEach(() => {
    execute.mockReset();
  });
  it('marks a direct hit as not an alias and reports the canonical slug', async () => {
    execute.mockResolvedValue([ROW]);

    const resolved = await resolvePublicBusinessRoute('demo-store');

    expect(resolved).toMatchObject({
      canonicalSlug: 'demo-store',
      requestedSlug: 'demo-store',
      matchedAlias: false,
    });
  });

  it('marks a retired slug as an alias of the canonical one', async () => {
    execute.mockResolvedValue([ROW]);

    const resolved = await resolvePublicBusinessRoute('demo-store-old');

    expect(resolved).toMatchObject({
      canonicalSlug: 'demo-store',
      requestedSlug: 'demo-store-old',
      matchedAlias: true,
    });
  });

  it('returns null when the slug resolves to nothing', async () => {
    execute.mockResolvedValue([]);

    await expect(resolvePublicBusinessRoute('missing')).resolves.toBeNull();
  });
});
