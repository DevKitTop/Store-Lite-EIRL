import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}));

import { resolveSettingsBusiness } from '@/core/business/privateSettings';

const PUBLIC_ROW = {
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

const PRIVATE_ROW = {
  id: 'b1',
  slug: 'demo-store',
  legal_rep_name: 'Ana Pérez',
  legal_rep_role: 'Gerente',
  legal_rep_phone: '+51911111111',
  legal_rep_email: 'ana@demo.test',
  culqi_public_key: 'pk_test_123',
  culqi_secret_key: 'sk_test_456',
  preferences: { storefront: { theme: 'modern' } },
  theme_mode: 'dark',
};

const OWNER_ID = '22222222-2222-4222-8222-222222222222';

describe('resolveSettingsBusiness', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('returns null when the slug does not resolve', async () => {
    execute.mockResolvedValue([]);

    await expect(resolveSettingsBusiness('missing', OWNER_ID)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when the user is not a member, without exposing private fields', async () => {
    execute.mockResolvedValueOnce([PUBLIC_ROW]).mockResolvedValueOnce([]);

    await expect(resolveSettingsBusiness('demo-store', OWNER_ID)).resolves.toBeNull();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('composes the public business with the private settings for a member', async () => {
    execute.mockResolvedValueOnce([PUBLIC_ROW]).mockResolvedValueOnce([PRIVATE_ROW]);

    const resolved = await resolveSettingsBusiness('demo-store', OWNER_ID);

    expect(resolved).toMatchObject({
      canonicalSlug: 'demo-store',
      requestedSlug: 'demo-store',
      matchedAlias: false,
    });
    expect(resolved?.business.name).toBe('Demo Store');
    expect(resolved?.privateSettings).toEqual({
      legalRepName: 'Ana Pérez',
      legalRepRole: 'Gerente',
      legalRepPhone: '+51911111111',
      legalRepEmail: 'ana@demo.test',
      culqiPublicKey: 'pk_test_123',
      culqiSecretKey: 'sk_test_456',
      preferences: { storefront: { theme: 'modern' } },
      themeMode: 'dark',
    });
  });

  it('marks a retired slug as an alias', async () => {
    execute.mockResolvedValueOnce([PUBLIC_ROW]).mockResolvedValueOnce([PRIVATE_ROW]);

    const resolved = await resolveSettingsBusiness('demo-store-old', OWNER_ID);

    expect(resolved).toMatchObject({
      canonicalSlug: 'demo-store',
      requestedSlug: 'demo-store-old',
      matchedAlias: true,
    });
  });

  it('falls back to light when the settings row is missing', async () => {
    execute
      .mockResolvedValueOnce([PUBLIC_ROW])
      .mockResolvedValueOnce([{ ...PRIVATE_ROW, theme_mode: null, preferences: null }]);

    const resolved = await resolveSettingsBusiness('demo-store', OWNER_ID);

    expect(resolved?.privateSettings.themeMode).toBe('light');
  });
});
