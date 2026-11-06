'use client';

import type { StorefrontColorScheme } from '@/core/storefront';
import type { PublicBusiness } from '@/types/business';
import { Footer } from '../Footer';
import { CartDrawer } from './CartDrawer';
import { FloatingCartButton } from './FloatingCartButton';
import { FloatingChatFab } from './FloatingChatFab';
import { ThemeToggle } from './ThemeToggle';

interface CustomerFloatingUiProps {
  business: PublicBusiness;
  paymentsEnabled: boolean;
  culqiPublicKey?: string;
  chatEnabled: boolean;
  activeScheme: StorefrontColorScheme;
  onViewerThemeToggle: () => void;
  onContactClick: () => void;
}

export function CustomerFloatingUi({
  business,
  paymentsEnabled,
  culqiPublicKey,
  chatEnabled,
  activeScheme,
  onViewerThemeToggle,
  onContactClick,
}: CustomerFloatingUiProps) {
  return (
    <>
      <FloatingCartButton />
      <CartDrawer
        hasPaymentGateway={paymentsEnabled}
        culqiPublicKey={culqiPublicKey}
        businessId={business.id}
        businessName={business.name}
        businessAddress={business.address ?? undefined}
        businessCity={business.city ?? undefined}
        businessLogoUrl={business.logoUrl ?? undefined}
        onContactClick={onContactClick}
      />
      {chatEnabled && (
        <FloatingChatFab
          businessName={business.name}
          businessId={business.id}
          slug={business.slug}
          businessLogo={business.logoUrl}
        />
      )}
      <ThemeToggle currentScheme={activeScheme} onToggle={onViewerThemeToggle} />
      <Footer business={business} />
    </>
  );
}
