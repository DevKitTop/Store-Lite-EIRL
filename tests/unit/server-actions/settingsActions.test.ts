// =====================================================
// settingsActions — Plan enforcement unit tests
// =====================================================

import {
  clearStorefrontTheme,
  toggleBusinessActive,
  updateBusinessSEO,
  updateBusinessSlug,
  updateCulqiCredentials,
  updateStorefrontLayout,
  updateStorefrontTheme,
} from '@/app/[slug]/(app)/settings/actions';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const mockRequireAccessOnId = vi.hoisted(() => vi.fn());

vi.mock('@/features/storage/actions/authz', () => ({
  requireAccessOnId: mockRequireAccessOnId,
}));

const mockGetEntitlements = vi.hoisted(() => vi.fn());

vi.mock('@/core/entitlements', () => ({
  getBusinessEntitlements: mockGetEntitlements,
}));

// Payment lock guard — actions.ts now calls hasLockingPayments; default to unlocked
const mockHasLockingPayments = vi.hoisted(() => vi.fn());

vi.mock('@/core/orders/paymentGuards', () => ({
  hasLockingPayments: mockHasLockingPayments,
}));

// Each action may call these; we mock them minimally
const {
  mockDbQueryBusinessesFindFirst,
  mockDbQueryBusinessSettingsFindFirst,
  mockDbUpdate,
  mockDbTransaction,
  mockDbInsert,
  mockDbDelete,
} = vi.hoisted(() => {
  const mockDbQueryBusinessesFindFirst = vi.fn();
  const mockDbQueryBusinessSettingsFindFirst = vi.fn();
  const mockDbUpdate = vi.fn();
  const mockDbTransaction = vi.fn();
  const mockDbInsert = vi.fn();
  const mockDbDelete = vi.fn();

  return {
    mockDbQueryBusinessesFindFirst,
    mockDbQueryBusinessSettingsFindFirst,
    mockDbUpdate,
    mockDbTransaction,
    mockDbInsert,
    mockDbDelete,
  };
});

const mockDbUpdateSet = vi.fn();
const mockDbUpdateWhere = vi.fn();
const mockDbInsertValues = vi.fn();
const mockDbInsertOnConflictDoNothing = vi.fn();
const mockDbDeleteWhere = vi.fn();

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: {
        findFirst: mockDbQueryBusinessesFindFirst,
      },
      businessSettings: {
        findFirst: mockDbQueryBusinessSettingsFindFirst,
      },
    },
    update: mockDbUpdate,
    insert: mockDbInsert,
    transaction: mockDbTransaction,
    delete: mockDbDelete,
  },
}));

vi.mock('@/core/business/slug', () => ({
  // original-impl form so restoreMocks keeps this resolved value across tests
  isBusinessSlugTaken: vi.fn(async () => false),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/posthogServer', () => ({
  getPostHogClient: vi.fn(() => ({
    capture: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Storefront helpers
vi.mock('@/core/storefront', () => ({
  normalizeStorefrontLayout: vi.fn((l: unknown) => l),
  normalizeStorefrontTheme: vi.fn((t: unknown) => t),
  mergeStorefrontLayoutIntoPreferences: vi.fn((prefs: unknown, layout: unknown) => ({
    ...(prefs as object),
    layout,
  })),
  mergeStorefrontThemeIntoPreferences: vi.fn((prefs: unknown, theme: unknown) => ({
    ...(prefs as object),
    theme,
  })),
  clearStorefrontThemeFromPreferences: vi.fn((prefs: unknown) => prefs),
  createDefaultStorefrontLayout: vi.fn(() => ({ type: 'default' })),
  createDefaultStorefrontTheme: vi.fn(() => ({ colors: { primary: '#000' } })),
}));

vi.mock('@/utils/crypto', () => ({
  encrypt: vi.fn((s: string) => `encrypted:${s}`),
}));

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz-test-123';

const LITE_ENTITLEMENTS = {
  plan: 'lite' as const,
  isActive: true,
  hasPaymentGateway: false,
  isPaymentConfigured: false,
  maxProducts: 50,
  maxCategories: 7,
  canImportProducts: false,
  canCustomizeStorefront: false,
  chatEnabled: true,
  dashboardEnabled: false,
  seoEnabled: false,
  canUseAIAssistant: false,
  maxTeamMembers: 1,
  culqiPublicKey: undefined as string | undefined,
  planEndDate: null as string | null,
};

const PREMIUM_ENTITLEMENTS = {
  plan: 'lite_pago' as const,
  isActive: true,
  hasPaymentGateway: true,
  isPaymentConfigured: true,
  maxProducts: 300,
  maxCategories: 7,
  canImportProducts: true,
  canCustomizeStorefront: true,
  chatEnabled: true,
  dashboardEnabled: true,
  seoEnabled: true,
  canUseAIAssistant: true,
  maxTeamMembers: 2,
  culqiPublicKey: 'pk_test_123',
  planEndDate: null as string | null,
};

// ── Suite ────────────────────────────────────────────

describe('settings actions — plan enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: requireAccessOnId resolves successfully
    mockRequireAccessOnId.mockResolvedValue({
      businessId: BUSINESS_ID,
      userId: 'user-1',
      isOwner: true,
    });

    // Chain update → set → where
    mockDbUpdate.mockReturnValue({ set: mockDbUpdateSet });
    mockDbUpdateSet.mockReturnValue({ where: mockDbUpdateWhere });
    mockDbUpdateWhere.mockResolvedValue(undefined);

    // Chain insert → values → onConflictDoNothing
    mockDbInsert.mockReturnValue({ values: mockDbInsertValues });
    mockDbInsertValues.mockReturnValue({ onConflictDoNothing: mockDbInsertOnConflictDoNothing });
    mockDbInsertOnConflictDoNothing.mockResolvedValue(undefined);

    // Chain delete → where
    mockDbDelete.mockReturnValue({ where: mockDbDeleteWhere });
    mockDbDeleteWhere.mockResolvedValue(undefined);

    // Transaction mock: calls the callback with the transaction object
    mockDbTransaction.mockImplementation(
      async (cb: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const tx = {
          insert: mockDbInsert,
          update: mockDbUpdate,
          delete: mockDbDelete,
        };
        return await cb(tx);
      },
    );

    // Business has no locking payment history (paymentGuards suite covers locking)
    mockHasLockingPayments.mockResolvedValue(false);
  });

  // ============================================================
  // PLAN ENFORCEMENT — lite returns error for all 7 actions
  // ============================================================

  describe('updateBusinessSlug', () => {
    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await updateBusinessSlug(BUSINESS_ID, 'new-slug-valid');

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes superiores.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
      // Should NOT proceed to DB operations
      expect(mockDbQueryBusinessesFindFirst).not.toHaveBeenCalled();
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessesFindFirst.mockResolvedValue({
        id: BUSINESS_ID,
        slug: 'old-slug',
      });

      const result = await updateBusinessSlug(BUSINESS_ID, 'new-slug-valid');

      // Should not return a plan error
      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('toggleBusinessActive', () => {
    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await toggleBusinessActive(BUSINESS_ID, true);

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes superiores.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);

      const result = await toggleBusinessActive(BUSINESS_ID, true);

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('updateBusinessSEO', () => {
    const seoData = {
      seoTitle: 'Test Title',
      seoDescription: 'Test description',
    };

    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await updateBusinessSEO(BUSINESS_ID, seoData);

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes superiores.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);

      const result = await updateBusinessSEO(BUSINESS_ID, seoData);

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('updateStorefrontLayout', () => {
    const layout = { type: 'grid' };

    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await updateStorefrontLayout(BUSINESS_ID, 'test-slug', layout);

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('returns error when plan is lite (legacy emprendedor fixture)', async () => {
      mockGetEntitlements.mockResolvedValue({
        ...LITE_ENTITLEMENTS,
        plan: 'lite' as const,
        hasPaymentGateway: true,
        seoEnabled: true,
        dashboardEnabled: true,
        canImportProducts: true,
        maxProducts: 150,
        maxTeamMembers: 3,
      });

      const result = await updateStorefrontLayout(BUSINESS_ID, 'test-slug', layout);

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue(null);

      const result = await updateStorefrontLayout(BUSINESS_ID, 'test-slug', layout);

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('updateStorefrontTheme', () => {
    const theme = { colors: { primary: '#ff0000' } };

    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await updateStorefrontTheme(BUSINESS_ID, 'test-slug', theme, 'light');

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('returns error when plan is lite (legacy emprendedor fixture)', async () => {
      mockGetEntitlements.mockResolvedValue({
        ...LITE_ENTITLEMENTS,
        plan: 'lite' as const,
        hasPaymentGateway: true,
        seoEnabled: true,
        dashboardEnabled: true,
        canImportProducts: true,
        maxProducts: 150,
        maxTeamMembers: 3,
      });

      const result = await updateStorefrontTheme(BUSINESS_ID, 'test-slug', theme, 'light');

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue(null);

      const result = await updateStorefrontTheme(BUSINESS_ID, 'test-slug', theme, 'light');

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('clearStorefrontTheme', () => {
    test('returns error when plan is lite', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await clearStorefrontTheme(BUSINESS_ID, 'test-slug');

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('returns error when plan is lite (legacy emprendedor fixture)', async () => {
      mockGetEntitlements.mockResolvedValue({
        ...LITE_ENTITLEMENTS,
        plan: 'lite' as const,
        hasPaymentGateway: true,
        seoEnabled: true,
        dashboardEnabled: true,
        canImportProducts: true,
        maxProducts: 150,
        maxTeamMembers: 3,
      });

      const result = await clearStorefrontTheme(BUSINESS_ID, 'test-slug');

      expect(result).toEqual({
        success: false,
        error: 'Funcion disponible solo para planes con personalizacion de storefront.',
      });
    });

    test('proceeds when plan is lite_pago', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue(null);

      const result = await clearStorefrontTheme(BUSINESS_ID, 'test-slug');

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });
  });

  describe('updateCulqiCredentials — hasPaymentGateway semantic check', () => {
    const publicKey = 'pk_test_abc123';
    const secretKey = 'sk_test_xyz789';

    test('returns error when plan is lite (hasPaymentGateway=false)', async () => {
      mockGetEntitlements.mockResolvedValue(LITE_ENTITLEMENTS);

      const result = await updateCulqiCredentials(BUSINESS_ID, publicKey, secretKey);

      expect(result).toEqual({
        success: false,
        error: 'La configuracion de pagos solo esta disponible en planes premium.',
      });

      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    test('returns error when plan is lite (legacy emprendedor fixture, no payment gateway)', async () => {
      mockGetEntitlements.mockResolvedValue({
        ...LITE_ENTITLEMENTS,
        plan: 'lite' as const,
        hasPaymentGateway: false,
        seoEnabled: true,
        dashboardEnabled: true,
        canImportProducts: true,
        maxProducts: 150,
        maxTeamMembers: 3,
      });

      const result = await updateCulqiCredentials(BUSINESS_ID, publicKey, secretKey);

      expect(result).toEqual({
        success: false,
        error: 'La configuracion de pagos solo esta disponible en planes premium.',
      });
    });

    test('proceeds when plan is lite_pago (hasPaymentGateway=true)', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue({ id: 'settings-1' });

      const result = await updateCulqiCredentials(BUSINESS_ID, publicKey, secretKey);

      expect(result.success).toBe(true);
      expect(mockGetEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    });

    // ============================================================
    // The settings screen no longer receives the stored secret, so
    // "empty" has to mean "keep the one already saved" instead of
    // wiping it or failing.
    // ============================================================

    test('keeps the stored secret when the new one is empty', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue({
        id: 'settings-1',
        culqiSecretKey: 'iv:stored:tag',
      });

      const result = await updateCulqiCredentials(BUSINESS_ID, publicKey, '');

      expect(result.success).toBe(true);
      expect(mockDbUpdateSet).toHaveBeenCalledTimes(1);
      const written = mockDbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      expect(written.culqiPublicKey).toBe(publicKey);
      expect(written).not.toHaveProperty('culqiSecretKey');
    });

    test('encrypts and stores a secret that was actually typed', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue({
        id: 'settings-1',
        culqiSecretKey: 'iv:stored:tag',
      });

      await updateCulqiCredentials(BUSINESS_ID, publicKey, secretKey);

      const written = mockDbUpdateSet.mock.calls[0][0] as Record<string, unknown>;
      expect(written.culqiSecretKey).toBe(`encrypted:${secretKey}`);
    });

    test('refuses an empty secret when nothing is stored yet', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue(null);

      const result = await updateCulqiCredentials(BUSINESS_ID, publicKey, '');

      expect(result).toEqual({
        success: false,
        error: 'Configurá la secret key de Culqi para habilitar los pagos.',
      });
      expect(mockDbUpdateSet).not.toHaveBeenCalled();
      expect(mockDbInsertValues).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // NO PLAN PARAM — Actions no longer accept plan argument
  // ============================================================

  describe('calling without plan parameter', () => {
    test('updateBusinessSlug works without plan param', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessesFindFirst.mockResolvedValue({
        id: BUSINESS_ID,
        slug: 'old-slug',
      });

      // Call with only 2 args (no plan)
      const result = await updateBusinessSlug(BUSINESS_ID, 'new-slug-valid');

      expect(result.success).toBe(true);
    });

    test('toggleBusinessActive works without plan param', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);

      const result = await toggleBusinessActive(BUSINESS_ID, false);

      expect(result.success).toBe(true);
    });

    test('updateCulqiCredentials works without plan param', async () => {
      mockGetEntitlements.mockResolvedValue(PREMIUM_ENTITLEMENTS);
      mockDbQueryBusinessSettingsFindFirst.mockResolvedValue({ id: 'settings-1' });

      const result = await updateCulqiCredentials(BUSINESS_ID, 'pk_test_abc', 'sk_test_xyz');

      expect(result.success).toBe(true);
    });
  });
});
