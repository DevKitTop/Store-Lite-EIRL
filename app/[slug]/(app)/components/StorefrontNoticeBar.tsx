'use client';

import { Icon } from '@/shared/components/ui/data-display/Icon';
import type { PublicBusiness } from '@/types/business';
import styles from '../BusinessPageContent.module.css';

interface StorefrontNoticeBarProps {
  isOwner: boolean;
  business: PublicBusiness;
  hasPaymentGateway: boolean;
  isPaymentConfigured: boolean;
}

export function StorefrontNoticeBar({
  isOwner,
  business,
  hasPaymentGateway,
  isPaymentConfigured,
}: StorefrontNoticeBarProps) {
  const paymentsEnabled = hasPaymentGateway && isPaymentConfigured;
  return (
    <>
      {/* ── Badge de confianza para el customer ── */}
      {!isOwner && business.verificationStatus === 'verified' && (
        <div className={styles.verifiedBadge}>
          <Icon size={14}>verified</Icon>
          Verificado
        </div>
      )}

      {/* ── Mensajes para el owner ── */}
      {isOwner && hasPaymentGateway && !isPaymentConfigured && (
        <div className={`${styles.ownerPrompt} ${styles.ownerPromptWarning}`}>
          <span className={styles.ownerPromptIcon}>⚠️</span>
          <span>Configura tus credenciales de pago para empezar a recibir pagos automáticos.</span>
        </div>
      )}
      {isOwner && !hasPaymentGateway && (
        <div className={`${styles.ownerPrompt} ${styles.ownerPromptInfo}`}>
          <span className={styles.ownerPromptIcon}>💡</span>
          <span>
            Estás en el plan Lite. Actualiza tu plan para aceptar pagos automáticos y acceder a más
            beneficios.
          </span>
        </div>
      )}

      {/* ── Info de pagos para el customer ── */}
      {!isOwner && !paymentsEnabled && (
        <div
          className={styles.paymentBanner}
          tabIndex={0}
          role="button"
          aria-label="Información de pagos"
        >
          <span className={styles.paymentBannerIcon}>?</span>
          <span>Pagos automáticos no disponibles</span>
          <div className={styles.paymentTooltip}>
            {hasPaymentGateway
              ? 'Este negocio aún no terminó de configurar sus credenciales de pago. Mientras tanto, puedes contactar al negocio para comprar.'
              : 'Este negocio necesita un plan premium para habilitar pagos automáticos. Mientras tanto, puedes contactar al negocio para comprar.'}
          </div>
        </div>
      )}
    </>
  );
}
