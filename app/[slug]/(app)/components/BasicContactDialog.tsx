'use client';

import { useCart } from '@/features/storage/context/CartContext';
import { Button } from '@/shared/components/ui/buttons/Button';
import { Icon } from '@/shared/components/ui/data-display/Icon';
import type { PublicBusiness } from '@/types/business';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './BasicContactDialog.module.css';

interface BasicContactDialogProps {
  business: PublicBusiness;
  onClose: () => void;
  isOpen: boolean;
}

export function BasicContactDialog({ business, onClose, isOpen }: BasicContactDialogProps) {
  const { cartItems, totalPrice } = useCart();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!isOpen || !mounted) return null;

  const handleWhatsApp = () => {
    // Clean phone number (remove spaces, +, etc for wa.me)
    const cleanNumber = business.whatsappNumber?.replace(/\D/g, '') || '';

    let message = `Hola ${business.name}, me gustaría obtener más información sobre sus productos.`;

    if (cartItems.length > 0) {
      const itemsList = cartItems.map((item) => `- ${item.name} x${item.quantity}`).join('\n');
      message = `Hola ${business.name}, me gustaría realizar el siguiente pedido:\n\n${itemsList}\n\nTotal: S/ ${totalPrice.toLocaleString()}`;
    }

    const encodedMessage = encodeURIComponent(message);
    window.open(`https://wa.me/${cleanNumber}?text=${encodedMessage}`, '_blank');
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <Button variant="text" onClick={onClose} className={styles.closeBtn}>
            <Icon>close</Icon>
          </Button>
          <h2 className={styles.title}>Información de Contacto</h2>
        </header>

        <div className={styles.content}>
          <p className={styles.description}>
            Este negocio utiliza un método de contacto directo para finalizar las compras.
          </p>

          <section className={styles.details}>
            <div className={styles.detailItem}>
              <Icon className={styles.detailIcon}>store</Icon>
              <div>
                <span className={styles.detailLabel}>Negocio</span>
                <span className={styles.detailValue}>{business.name}</span>
              </div>
            </div>

            {business.whatsappNumber && (
              <div className={styles.detailItem}>
                <Icon className={styles.detailIcon}>chat</Icon>
                <div>
                  <span className={styles.detailLabel}>WhatsApp</span>
                  <span className={styles.detailValue}>{business.whatsappNumber}</span>
                </div>
              </div>
            )}

            {business.address && (
              <div className={styles.detailItem}>
                <Icon className={styles.detailIcon}>location_on</Icon>
                <div>
                  <span className={styles.detailLabel}>Dirección</span>
                  <span className={styles.detailValue}>{business.address}</span>
                </div>
              </div>
            )}
          </section>

          {cartItems.length > 0 && (
            <section className={styles.summary}>
              <h3 className={styles.summaryTitle}>Resumen del Pedido</h3>
              <div className={styles.summaryList}>
                {cartItems.map((item, idx) => (
                  <div key={idx} className={styles.summaryItem}>
                    <span>
                      {item.name} x{item.quantity}
                    </span>
                    <span>S/ {(Number(item.price) * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
                <div className={styles.summaryTotal}>
                  <span>Total</span>
                  <span>S/ {totalPrice.toLocaleString()}</span>
                </div>
              </div>
            </section>
          )}
        </div>

        <footer className={styles.footer}>
          <Button variant="filled" onClick={handleWhatsApp} className={styles.whatsappBtn}>
            <Icon size={20} style={{ paddingTop: 4, paddingRight: 25 }}>
              chat
            </Icon>
            Contactar por WhatsApp
          </Button>

          <Button variant="tonal" onClick={() => window.print()} className={styles.printBtn}>
            <Icon size={21} style={{ paddingTop: 4, paddingRight: 25 }}>
              download
            </Icon>
            Descargar Resumen (PDF)
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
