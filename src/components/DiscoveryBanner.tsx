import {
  buildPromotionSettingsPath,
  isDiscoveryBannerVisible,
  type PromotionOfferView,
} from '@/features/promotions/discoveryRules';
import Link from 'next/link';

interface DiscoveryBannerProps {
  slug: string;
  offer: PromotionOfferView | null;
  isOwner: boolean;
}

/**
 * Owner-only acquisition nudge shown across the admin app while the
 * free-period offer is still available. It is deliberately absent for team
 * members and for active/used offers.
 */
export function DiscoveryBanner({ slug, offer, isOwner }: DiscoveryBannerProps) {
  if (!offer || !isDiscoveryBannerVisible({ isOwner, offerState: offer.state })) {
    return null;
  }

  const settingsUrl = buildPromotionSettingsPath(slug);

  return (
    <aside
      aria-label="Oferta de bienvenida"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        margin: '12px 16px 0',
        padding: '12px 18px',
        borderRadius: '12px',
        background: 'var(--md-sys-color-tertiary-container)',
        color: 'var(--md-sys-color-on-tertiary-container)',
      }}
    >
      <div>
        <strong style={{ display: 'block', fontSize: '14px' }}>
          Probá {offer.durationDays} días de Lite Pago sin cobro
        </strong>
        <span style={{ display: 'block', fontSize: '12px', opacity: 0.9 }}>
          Sin tarjeta ni cargo. Reclamalo desde Opciones → Plan y Límites. Al vencer volvés a Lite,
          el catálogo queda en 50 productos, los excedentes se ocultan y el dashboard se desactiva.
        </span>
      </div>
      <Link
        href={settingsUrl}
        style={{
          borderRadius: '999px',
          padding: '8px 16px',
          background: 'var(--md-sys-color-primary)',
          color: 'var(--md-sys-color-on-primary)',
          fontSize: '13px',
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        Ver oferta
      </Link>
    </aside>
  );
}
