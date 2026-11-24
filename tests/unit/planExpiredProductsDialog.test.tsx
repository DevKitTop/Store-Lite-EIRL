import { PlanExpiredProductsDialog } from '@/app/[slug]/(app)/dashboard/components/PlanExpiredProductsDialog';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/components/ui/surfaces', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null,
}));

const products = [
  { id: 'prod_1', title: 'Producto A' },
  { id: 'prod_2', title: 'Producto B' },
];

const planEndDate = '2024-01-01T00:00:00.000Z';
const storageKey = `store-lite-expired-products:biz_1:${planEndDate}`;

describe('PlanExpiredProductsDialog', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows the disabled products and remembers the dismissal', () => {
    render(
      <PlanExpiredProductsDialog
        businessId="biz_1"
        planEndDate={planEndDate}
        products={products}
      />,
    );

    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          element.textContent?.includes('Se desactivaron 2 producto(s)') === true,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Producto A')).toBeInTheDocument();
    expect(screen.getByText('Producto B')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Entendido'));

    expect(localStorage.getItem(storageKey)).toBe('1');
    expect(screen.queryByText('Producto A')).not.toBeInTheDocument();
  });

  it('does not show again once the dismissal was stored', () => {
    localStorage.setItem(storageKey, '1');

    render(
      <PlanExpiredProductsDialog
        businessId="biz_1"
        planEndDate={planEndDate}
        products={products}
      />,
    );

    expect(screen.queryByText('Producto A')).not.toBeInTheDocument();
  });
});
