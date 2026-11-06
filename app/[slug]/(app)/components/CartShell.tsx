'use client';

import type { PublicBusiness } from '@/types/business';
import { useState } from 'react';
import { BasicContactDialog } from './BasicContactDialog';
import { CartDrawer } from './CartDrawer';
import { FloatingCartButton } from './FloatingCartButton';

interface CartShellProps {
  hasPaymentGateway: boolean;
  culqiPublicKey?: string;
  businessId: string;
  businessName: string;
  businessAddress?: string;
  businessCity?: string;
  businessLogoUrl?: string;
  business: PublicBusiness;
}

export function CartShell({
  hasPaymentGateway,
  culqiPublicKey,
  businessId,
  businessName,
  businessAddress,
  businessCity,
  businessLogoUrl,
  business,
}: CartShellProps) {
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);

  return (
    <>
      <FloatingCartButton />
      <CartDrawer
        hasPaymentGateway={hasPaymentGateway}
        culqiPublicKey={culqiPublicKey}
        businessId={businessId}
        businessName={businessName}
        businessAddress={businessAddress}
        businessCity={businessCity}
        businessLogoUrl={businessLogoUrl}
        onContactClick={() => setIsContactDialogOpen(true)}
      />
      <BasicContactDialog
        business={business}
        isOpen={isContactDialogOpen}
        onClose={() => setIsContactDialogOpen(false)}
      />
    </>
  );
}
