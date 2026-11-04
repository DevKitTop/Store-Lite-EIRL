'use client';

import type { StorefrontColorScheme, StorefrontTheme } from '@/core/storefront';
import { createDefaultStorefrontTheme } from '@/core/storefront';
import {
  BusinessPreviewCard,
  SocialLinksRow,
} from '@/shared/components/business/BusinessPreviewCard';
import { Icon } from '@/shared/components/ui/data-display/Icon';
import type { PublicBusiness } from '@/types/business';
import styles from './storefrontAbout.module.css';

// ─── Pure business-logic helpers (unit-tested) ────────────────────────────

/**
 * Builds a Google Maps search URL from a business's location parts.
 * Returns '' when no parts are present.
 */
export function buildGoogleMapsUrl(business: {
  address?: string | null;
  city?: string | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  country?: string | null;
}): string {
  const parts = [
    business.address,
    business.city,
    business.departamento,
    business.provincia,
    business.distrito,
    business.country,
  ]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .map((p) => p.trim());
  if (parts.length === 0) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`;
}

/** Mapea el tipo de persona a texto amigable (copiado de AboutSection.tsx). */
export function getPersonTypeLabel(personType: string | null | undefined): string {
  switch (personType) {
    case 'natural':
      return 'Persona Natural con Negocio';
    case 'juridica':
      return 'Persona Jurídica';
    default:
      return '—';
  }
}

export type VerificationTone = 'verified' | 'pending' | 'unverified' | 'rejected';

export interface VerificationConfig {
  label: string;
  icon: string;
  tone: VerificationTone;
}

/**
 * Traduce cualquier estado de verificación a un badge real (design D3, spec R2).
 * Valores desconocidos/nulos caen a "Sin verificar" — el estilo "Verificado"
 * nunca se muestra para otro estado.
 */
export function getVerificationConfig(status: string | null | undefined): VerificationConfig {
  switch (status) {
    case 'verified':
      return { label: 'Verificado', icon: 'verified', tone: 'verified' };
    case 'pending':
      return { label: 'En verificación', icon: 'hourglass_top', tone: 'pending' };
    case 'rejected':
      return { label: 'No verificado', icon: 'cancel', tone: 'rejected' };
    default:
      return { label: 'Sin verificar', icon: 'info', tone: 'unverified' };
  }
}

// ─── Detail rows (each handles its own null-state) ─────────────────────────

function DireccionRow({ address }: { address: string | null }) {
  if (!address) return null;
  return (
    <div className={styles.detailItem}>
      <strong>Dirección:</strong>
      <span>{address}</span>
    </div>
  );
}

function TipoRow({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div className={styles.detailItem}>
      <strong>Tipo:</strong>
      <span>{value}</span>
    </div>
  );
}

function CorreoRow({ email }: { email: string | null }) {
  if (!email) return null;
  return (
    <div className={styles.detailItem}>
      <strong>Correo:</strong>
      <a
        className={styles.contactLink}
        href={`mailto:${email}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Enviar correo a ${email}`}
      >
        {email}
      </a>
    </div>
  );
}

function WhatsAppRow({ phoneNumber, phoneDigits }: { phoneNumber: string; phoneDigits: string }) {
  if (!phoneDigits) return null;
  return (
    <div className={styles.detailItem}>
      <strong>WhatsApp:</strong>
      <a
        className={styles.contactLink}
        href={`https://wa.me/${phoneDigits}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`WhatsApp al ${phoneNumber}`}
      >
        {phoneNumber}
      </a>
    </div>
  );
}

function VerificationBadgeRow({ verification }: { verification: VerificationConfig }) {
  return (
    <div className={`${styles.verificationBadge} ${styles[verification.tone]}`}>
      <Icon className={styles.verificationIcon} size={18}>
        {verification.icon}
      </Icon>
      <span className={styles.verificationTitle}>{verification.label}</span>
    </div>
  );
}

function MapLinkRow({ url }: { url: string }) {
  if (!url) return null;
  return (
    <div className={styles.detailItem}>
      <a
        className={styles.contactLink}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Cómo llegar"
      >
        Cómo llegar
      </a>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────

interface StorefrontAboutSectionProps {
  business: PublicBusiness;
  storefrontTheme: StorefrontTheme | null | undefined;
  previewCardTheme: StorefrontTheme | null | undefined;
  storefrontColorScheme?: StorefrontColorScheme;
  isOwner: boolean;
}

/** Sección "Nosotros" del storefront (público). */
export function StorefrontAboutSection({
  business,
  storefrontTheme,
  previewCardTheme,
  storefrontColorScheme,
  isOwner,
}: StorefrontAboutSectionProps) {
  const verification = getVerificationConfig(business.verificationStatus);
  // Only the store's own contact number. The legal representative's phone is
  // personal data and is no longer part of the public projection.
  const phoneNumber = business.whatsappNumber ?? '';
  const phoneDigits = phoneNumber.replace(/\D/g, '');
  const personTypeLabel = business.personType ? getPersonTypeLabel(business.personType) : '';
  const typeValue = [personTypeLabel, business.storeType].filter(Boolean).join(' • ');

  return (
    <div className={styles.container}>
      <div className={styles.grid}>
        <div className={styles.contentColumn}>
          <div className={styles.infoCard}>
            <h2 className={styles.infoTitle}>Sobre nosotros</h2>

            {business.description && <p className={styles.description}>{business.description}</p>}

            <div className={styles.detailsGrid}>
              <DireccionRow address={business.address} />
              <MapLinkRow
                url={buildGoogleMapsUrl({
                  address: business.address,
                  city: business.city,
                  departamento: business.departamento,
                  provincia: business.provincia,
                  distrito: business.distrito,
                  country: business.country,
                })}
              />
              <TipoRow value={typeValue} />
              <CorreoRow email={business.email} />
              <WhatsAppRow phoneNumber={phoneNumber} phoneDigits={phoneDigits} />
            </div>

            <VerificationBadgeRow verification={verification} />

            <div style={{ marginTop: '1rem' }}>
              <SocialLinksRow links={business.socialLinks ?? {}} isDark={false} />
            </div>
          </div>
        </div>

        <div className={styles.cardColumn}>
          <BusinessPreviewCard
            commercialName={business.name}
            sector={business.storeType || ''}
            country={business.country || ''}
            city={business.city || ''}
            address={business.address || ''}
            email={business.email || ''}
            description={business.description || ''}
            taxId={business.taxId || ''}
            logoPreview={business.logoUrl}
            storefrontTheme={previewCardTheme || storefrontTheme || createDefaultStorefrontTheme()}
            colorScheme={storefrontColorScheme}
            showDownloadButton={isOwner}
            socialLinks={business.socialLinks ?? {}}
            whatsappNumber={business.whatsappNumber ?? undefined}
            verificationStatus={business.verificationStatus ?? undefined}
            coverImageUrl={business.coverImageUrl ?? null}
            storeType={business.storeType ?? undefined}
          />
        </div>
      </div>
    </div>
  );
}
