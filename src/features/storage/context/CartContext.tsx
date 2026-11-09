'use client';

import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import posthog from 'posthog-js';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Product } from '../data';

/** Valida que un string sea un UUID v4 (formato 8-4-4-4-12) */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CartItem extends Product {
  quantity: number;
}

/** Datos frescos de un producto desde el servidor */
export interface CartServerItem {
  id: string;
  stock: number;
  price: string;
  secondPrice: string | null;
  currency: string;
  isAvailable: boolean;
}

interface CartContextType {
  cartItems: CartItem[];
  addToCart: (product: Product) => void;
  removeFromCart: (productId: string) => void;
  toggleCartItem: (product: Product) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  isInCart: (productId: string) => boolean;
  clearCart: () => void;
  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;
  totalItems: number;
  totalPrice: number;
  /** Resultado de la última validación contra el servidor */
  cartValidation: Record<string, CartServerItem> | null;
  isCartValidating: boolean;
  /** Valida el carrito contra el servidor (productos eliminados, stock, precios) */
  validateCart: () => Promise<void>;
}

export const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider = ({
  children,
  businessSlug,
}: {
  children: React.ReactNode;
  businessSlug: string;
}) => {
  // Persistence Key
  const STORAGE_KEY = `cart_${businessSlug}`;

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [cartValidation, setCartValidation] = useState<Record<string, CartServerItem> | null>(null);
  const [isCartValidating, setIsCartValidating] = useState(false);

  // Generación de validación — incrementa cada vez que se pide validateCart.
  // Sirve para descartar respuestas stale cuando se agregan items mientras se valida.
  const validationGenRef = useRef(0);

  // Load from localStorage on mount
  useEffect(() => {
    const savedCart = localStorage.getItem(STORAGE_KEY);
    if (savedCart) {
      try {
        setCartItems(JSON.parse(savedCart));
      } catch (e) {
        console.error('Error loading cart from localStorage', e);
      }
    }
    setIsInitialized(true);
  }, [STORAGE_KEY]);

  // Save to localStorage
  useEffect(() => {
    if (isInitialized) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cartItems));
    }
  }, [cartItems, STORAGE_KEY, isInitialized]);

  const addToCart = (product: Product) => {
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === product.id);
      if (existingItem) {
        // Prevent adding more than available stock
        if (existingItem.quantity >= product.stock) {
          return prevItems;
        }
        posthog.capture(AnalyticsEvents.CART_ITEM_ADDED, {
          product_id: product.id,
          product_name: product.name,
          quantity: existingItem.quantity + 1,
          store_slug: businessSlug,
        });
        return prevItems.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        );
      }
      // If product has no stock, don't add
      if (product.stock <= 0) {
        return prevItems;
      }
      posthog.capture(AnalyticsEvents.CART_ITEM_ADDED, {
        product_id: product.id,
        product_name: product.name,
        quantity: 1,
        store_slug: businessSlug,
      });
      return [...prevItems, { ...product, quantity: 1 }];
    });
    // Invalidar validación previa — el carrito cambió, hay que re-validar
    setCartValidation(null);
  };

  const removeFromCart = (productId: string) => {
    setCartItems((prevItems) => prevItems.filter((item) => item.id !== productId));
    setCartValidation(null);
  };

  const toggleCartItem = (product: Product) => {
    if (isInCart(product.id)) {
      removeFromCart(product.id);
    } else {
      addToCart(product);
    }
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }

    setCartItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id === productId) {
          // Cap quantity at stock limit
          const newQuantity = Math.min(quantity, item.stock);
          return { ...item, quantity: newQuantity };
        }
        return item;
      }),
    );
    setCartValidation(null);
  };

  const isInCart = (productId: string) => {
    return cartItems.some((item) => item.id === productId);
  };

  const clearCart = () => {
    setCartItems([]);
    setCartValidation(null);
  };

  const validateCart = useCallback(async () => {
    const ids = cartItems.map((item) => item.id);
    if (ids.length === 0) return;

    // Filtrar solo UUIDs válidos — PostgreSQL rechaza IDs no-UUID en columna uuid
    const validIds = ids.filter((id): id is string => UUID_RE.test(id));
    if (validIds.length === 0) return;

    // Marcar generación para detectar respuestas stale
    const gen = ++validationGenRef.current;
    setIsCartValidating(true);

    try {
      const res = await fetch('/api/cart/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: validIds }),
      });

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const errBody = await res.json();
          if (errBody?.error) detail += ` — ${errBody.error}`;
        } catch {
          // ignore if body isn't valid JSON
        }
        throw new Error(`Error al validar carrito (${detail})`);
      }

      // Si entre que se disparó la request y ahora se agregaron/quitaron items,
      // descartamos esta respuesta — la nueva generación ya se está ejecutando.
      if (gen !== validationGenRef.current) return;

      const data = await res.json();

      const validationMap: Record<string, CartServerItem> = {};
      for (const item of data.items) {
        validationMap[item.id] = item;
      }
      setCartValidation(validationMap);
    } catch (e) {
      console.error('[CartContext] validate error:', e);
      // Setear validation como vacío para ROMPER el bucle infinito:
      // si lo dejamos null, el efecto en CartDrawer lo vuelve a llamar.
      setCartValidation({});
    } finally {
      setIsCartValidating(false);
    }
  }, [cartItems]);

  const totalItems = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = cartItems.reduce((acc, item) => {
    const activePrice = item.secondPrice ? Number(item.secondPrice) : Number(item.price);
    return acc + activePrice * item.quantity;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        toggleCartItem,
        updateQuantity,
        isInCart,
        clearCart,
        isCartOpen,
        setIsCartOpen,
        totalItems,
        totalPrice,
        cartValidation,
        isCartValidating,
        validateCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
