'use client';

import type { DisabledProduct } from '@/core/entitlements/plans';
import { Dialog } from '@/shared/components/ui/surfaces';
import { useEffect, useState } from 'react';

interface Props {
  businessId: string;
  planEndDate: string | null;
  products: DisabledProduct[];
}

function getStorageKey(businessId: string, planEndDate: string | null) {
  return `store-lite-expired-products:${businessId}:${planEndDate ?? 'none'}`;
}

export function PlanExpiredProductsDialog({ businessId, planEndDate, products }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (products.length === 0) return;
    if (localStorage.getItem(getStorageKey(businessId, planEndDate)) === '1') return;
    setOpen(true);
  }, [businessId, planEndDate, products]);

  if (products.length === 0) return null;

  const handleClose = () => {
    localStorage.setItem(getStorageKey(businessId, planEndDate), '1');
    setOpen(false);
  };

  return (
    <Dialog open={open} onClose={handleClose} type="alert">
      <div slot="headline">Tu plan venció</div>
      <div slot="content">
        <p style={{ margin: '0 0 0.75rem', lineHeight: 1.6 }}>
          Se desactivaron {products.length} producto(s) por superar el límite del plan Lite:
        </p>
        <ul style={{ margin: 0, paddingLeft: '1.25rem', lineHeight: 1.7 }}>
          {products.map((product) => (
            <li key={product.id}>{product.title}</li>
          ))}
        </ul>
        <p style={{ margin: '0.75rem 0 0', lineHeight: 1.6 }}>
          Puedes reactivarlos desde Almacén o mejorar tu plan para recuperar el límite.
        </p>
      </div>
      <div slot="actions">
        <md-filled-button onClick={handleClose}>Entendido</md-filled-button>
      </div>
    </Dialog>
  );
}
