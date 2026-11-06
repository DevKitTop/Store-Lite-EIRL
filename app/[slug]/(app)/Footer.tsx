'use client';

import { Icon } from '@/shared/components/ui/data-display/Icon';
import type { PublicBusiness } from '@/types/business';
import Image from 'next/image';
import Link from 'next/link';
import styles from './Footer.module.css';

interface FooterProps {
  business: PublicBusiness;
}

const STORE_TYPE_LABELS: Record<string, string> = {
  store: 'Tienda',
  service: 'Servicios',
  consultancy: 'Consultoría',
};

function formatStoreType(storeType: string | null): string | null {
  if (!storeType) return null;
  const lower = storeType.toLowerCase();
  return STORE_TYPE_LABELS[lower] || storeType;
}

function formatDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return null;

  const meses = [
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre',
  ];
  return `${d.getDate()} de ${meses[d.getMonth()]} del ${d.getFullYear()}`;
}

export function Footer({ business }: FooterProps) {
  const currentYear = new Date().getFullYear();
  const storeTypeLabel = formatStoreType(business.storeType);

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        {/* Columna 1: Brand */}
        <div className={styles.column}>
          <div className={styles.brand}>
            {business.logoUrl && (
              <Image
                src={business.logoUrl}
                alt={business.name}
                width={48}
                height={48}
                className={styles.brandLogo}
              />
            )}
            <div className={styles.brandInfo}>
              <span className={styles.brandName}>{business.name}</span>
              <span className={styles.businessMeta}>
                {storeTypeLabel && <span className={styles.businessType}>{storeTypeLabel}</span>}
                {storeTypeLabel && business.createdAt && (
                  <span className={styles.metaSep}>&middot;</span>
                )}
                {business.createdAt && (
                  <span className={styles.businessDate}>{formatDate(business.createdAt)}</span>
                )}
              </span>
            </div>
          </div>
          {business.description && <p className={styles.description}>{business.description}</p>}
          <p className={styles.copyrightText}>
            &copy; {currentYear} {business.name}. Todos los derechos reservados.
          </p>
        </div>

        {/* Columna 2: Información */}
        <div className={styles.column}>
          <h4 className={styles.columnTitle}>Información</h4>
          <div className={styles.infoList}>
            {/* Dirección completa */}
            {buildAddress(business) && (
              <div className={styles.infoItem}>
                <Icon className={styles.infoIcon}>location_on</Icon>
                <span>{buildAddress(business)}</span>
              </div>
            )}
            {business.whatsappNumber && (
              <div className={styles.infoItem}>
                <Icon className={styles.infoIcon}>call</Icon>
                <a
                  href={`https://wa.me/${business.whatsappNumber.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.infoLink}
                >
                  {business.whatsappNumber}
                </a>
              </div>
            )}
            {business.email && (
              <div className={styles.infoItem}>
                <Icon className={styles.infoIcon}>mail</Icon>
                <a href={`mailto:${business.email}`} className={styles.infoLink}>
                  {business.email}
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Columna 3: Legales */}
        <div className={styles.column}>
          <h4 className={styles.columnTitle}>Legales</h4>
          <div className={styles.infoList}>
            <div className={styles.infoItem}>
              <Icon className={styles.infoIcon}>description</Icon>
              <Link href={`/${business.slug}/terminos`} className={styles.infoLink}>
                Términos y Condiciones
              </Link>
            </div>
            <div className={styles.infoItem}>
              <Icon className={styles.infoIcon}>undo</Icon>
              <Link href={`/${business.slug}/devoluciones`} className={styles.infoLink}>
                Política de Devoluciones
              </Link>
            </div>
            <div className={styles.infoItem}>
              <Icon className={styles.infoIcon}>contact_support</Icon>
              <Link href={`/${business.slug}/libro-reclamaciones`} className={styles.infoLink}>
                Libro de Reclamaciones
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function buildAddress(business: PublicBusiness): string | null {
  const parts: string[] = [];
  if (business.address) parts.push(business.address);
  if (business.distrito) parts.push(business.distrito);
  if (business.provincia) parts.push(business.provincia);
  if (business.departamento) parts.push(business.departamento);
  if (business.city && business.city !== business.departamento) {
    parts.push(business.city);
  }
  if (business.country) parts.push(business.country);
  return parts.length > 0 ? parts.join(', ') : null;
}
