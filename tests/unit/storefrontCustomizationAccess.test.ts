import {
  hasStorefrontCustomizationAccess,
  hasStorefrontEditPermission,
  STOREFRONT_CUSTOMIZATION_DENIED_MESSAGE,
} from '@/core/storefront/storefrontCustomizationAccess';
import type { Permission } from '@/lib/permissions/definitions';
import { describe, expect, it } from 'vitest';

describe('storefront customization access (T27)', () => {
  const cases: {
    name: string;
    isOwner: boolean;
    permissions: Permission[];
    canCustomizeStorefrontPlan: boolean;
    expected: boolean;
  }[] = [
    {
      name: 'owner on eligible plan',
      isOwner: true,
      permissions: [],
      canCustomizeStorefrontPlan: true,
      expected: true,
    },
    {
      name: 'owner on lite plan',
      isOwner: true,
      permissions: [],
      canCustomizeStorefrontPlan: false,
      expected: false,
    },
    {
      name: 'member with storefront.edit on eligible plan',
      isOwner: false,
      permissions: ['storefront.edit'],
      canCustomizeStorefrontPlan: true,
      expected: true,
    },
    {
      name: 'member with storefront.edit on lite plan',
      isOwner: false,
      permissions: ['storefront.edit'],
      canCustomizeStorefrontPlan: false,
      expected: false,
    },
    {
      name: 'member without storefront.edit on eligible plan',
      isOwner: false,
      permissions: ['products.edit'],
      canCustomizeStorefrontPlan: true,
      expected: false,
    },
  ];

  it.each(cases)('resolves $name', (testCase) => {
    const hasEditPermission = hasStorefrontEditPermission({
      isOwner: testCase.isOwner,
      permissions: testCase.permissions,
    });

    expect(
      hasStorefrontCustomizationAccess({
        hasEditPermission,
        canCustomizeStorefrontPlan: testCase.canCustomizeStorefrontPlan,
      }),
    ).toBe(testCase.expected);
  });

  it('uses the same denial message server actions return', () => {
    expect(STOREFRONT_CUSTOMIZATION_DENIED_MESSAGE).toBe(
      'Funcion disponible solo para planes con personalizacion de storefront.',
    );
  });
});
