import { resolveAddToCart, type CartItem } from '@/features/storage/context/cartOperations';
import type { Product } from '@/features/storage/data';
import { describe, expect, it } from 'vitest';

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'Plan 99',
  category: 'Plan',
  stock: 5,
  price: '99',
  currency: 'PEN',
  status: 'Active',
  image: '/img.png',
  ...overrides,
});

const line = (overrides: Partial<CartItem> = {}): CartItem => ({
  ...product(),
  quantity: 1,
  ...overrides,
});

describe('resolveAddToCart', () => {
  it('agrega un producto nuevo con stock disponible con cantidad 1', () => {
    const result = resolveAddToCart([], product());

    expect(result.added).toBe(true);
    expect(result.quantity).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('p1');
    expect(result.items[0].quantity).toBe(1);
  });

  it('incrementa la cantidad de un producto que ya está en el carrito', () => {
    const existing = line({ quantity: 2 });

    const result = resolveAddToCart([existing], product());

    expect(result.added).toBe(true);
    expect(result.quantity).toBe(3);
    expect(result.items[0].quantity).toBe(3);
    expect(result.items).toHaveLength(1);
  });

  it('no agrega cuando el producto ya alcanzó el stock disponible', () => {
    const cart: CartItem[] = [line({ quantity: 5 })];

    const result = resolveAddToCart(cart, product({ stock: 5 }));

    expect(result.added).toBe(false);
    expect(result.quantity).toBeNull();
    expect(result.items[0].quantity).toBe(5);
  });

  it('no agrega un producto nuevo sin stock', () => {
    const result = resolveAddToCart([], product({ stock: 0 }));

    expect(result.added).toBe(false);
    expect(result.quantity).toBeNull();
    expect(result.items).toHaveLength(0);
  });

  it('calcula la cantidad sobre el producto correcto y conserva los demás ítems', () => {
    const other = line({ id: 'p2', name: 'Otro plan', quantity: 4 });
    const target = line({ id: 'p1', quantity: 1 });

    const result = resolveAddToCart([other, target], product({ id: 'p1' }));

    expect(result.quantity).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === 'p2')?.quantity).toBe(4);
    expect(result.items.find((item) => item.id === 'p1')?.quantity).toBe(2);
  });
});
