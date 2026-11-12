import type { Product } from '../data';

/** Producto del carrito con su cantidad. */
export interface CartItem extends Product {
  quantity: number;
}

export interface AddToCartResult {
  /** true cuando el producto efectivamente entra al carrito (hay stock). */
  added: boolean;
  /** Cantidad resultante del producto; null cuando no se agrega. */
  quantity: number | null;
  /** Carrito resultante. Es la misma referencia recibida cuando no se agrega. */
  items: CartItem[];
}

/**
 * Decide y aplica el alta de un producto en el carrito.
 *
 * Función pura. El alta se resuelve aquí y el evento de analytics se emite
 * fuera, en el provider: un updater de estado de React puede ejecutarse más de
 * una vez (StrictMode, renders descartados) y emitir allí duplica o pierde
 * eventos.
 */
export function resolveAddToCart(cartItems: CartItem[], product: Product): AddToCartResult {
  const existingItem = cartItems.find((item) => item.id === product.id);

  if (existingItem) {
    // No superar el stock disponible
    if (existingItem.quantity >= product.stock) {
      return { added: false, quantity: null, items: cartItems };
    }

    const quantity = existingItem.quantity + 1;
    return {
      added: true,
      quantity,
      items: cartItems.map((item) => (item.id === product.id ? { ...item, quantity } : item)),
    };
  }

  // Sin stock no entra al carrito
  if (product.stock <= 0) {
    return { added: false, quantity: null, items: cartItems };
  }

  return { added: true, quantity: 1, items: [...cartItems, { ...product, quantity: 1 }] };
}
