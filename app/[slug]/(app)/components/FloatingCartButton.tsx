'use client';

import { useCart } from '@/features/storage/context/CartContext';
import { Badge, Icon } from '@/shared/components/ui';
import { Button } from '@/shared/components/ui/buttons';
import styles from './FloatingCartButton.module.css';

export function FloatingCartButton() {
  const { totalItems, setIsCartOpen, cartItems } = useCart();

  if (cartItems.length === 0) return null;

  return (
    <div className={styles.container} data-floating-cart="">
      <Button variant="elevated" className={styles.cartBtn} onClick={() => setIsCartOpen(true)}>
        <div className={styles.content}>
          <div className={styles.iconWrapper}>
            <Icon size={21}>shopping_cart</Icon>
          </div>
          <span className={styles.label}>Carrito</span>
          <Badge count={totalItems} />
        </div>
      </Button>
    </div>
  );
}
