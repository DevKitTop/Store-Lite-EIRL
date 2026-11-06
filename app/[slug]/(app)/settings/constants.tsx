'use client';

import {
  normalizeStorefrontLayout,
  type StorefrontLayout,
  type StorefrontPalette,
  type StorefrontSection,
  type StorefrontTheme,
} from '@/core/storefront';
import type { Permission } from '@/lib/permissions/definitions';
import { Icon, IconButton, LinearProgress } from '@/shared/components/ui';
import { getCounterStatus, type OptimalRange } from '@/shared/seo/seoPreview';
import React, { useState } from 'react';
import styles from './settings.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SettingsBusiness {
  id: string;
  name: string;
  slug: string;
  coverImageUrl: string | null;
  logoUrl: string | null;
  address: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  storeType: string | null;
  description: string | null;
  whatsappNumber: string | null;
  socialLinks: Record<string, string> | null;
  taxId: string | null;
  personType: string | null;
  country: string | null;
  city: string | null;
  email: string | null;
  legalRepName: string | null;
  legalRepRole: string | null;
  legalRepPhone: string | null;
  legalRepEmail: string | null;
  paymentFlow: string[] | null;
  latitude: string | null;
  longitude: string | null;
  geoRegion: string | null;
  geoPlacename: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[] | null;
  isActive: boolean;
  culqiPublicKey: string | null;
  /**
   * Whether a secret key is stored. The value itself never leaves the server:
   * `business_settings.culqi_secret_key` is the seller's live credential, and
   * older rows still hold it in plain text.
   */
  hasCulqiSecretKey: boolean;
  preferences: Record<string, unknown> | null;
  createdAt: Date;
}

export interface Entitlements {
  plan: string;
  isActive: boolean;
  hasPaymentGateway: boolean;
  maxProducts: number;
  canImportProducts: boolean;
  canCustomizeStorefront: boolean;
  chatEnabled: boolean;
  dashboardEnabled: boolean;
  canUseAIAssistant: boolean;
  maxTeamMembers: number;
  seoEnabled: boolean;
  planEndDate: string | null;
  productCount: number;
  memberCount: number;
}

export interface SettingsClientProps {
  business: SettingsBusiness;
  entitlements: Entitlements;
  initialStorefrontLayout: StorefrontLayout;
  initialStorefrontTheme: StorefrontTheme;
  initialHasCustomTheme?: boolean;
  initialScheme?: 'light' | 'dark';
  businessLocked: boolean;
  role: string;
  permissions: Permission[];
  isOwner: boolean;
}

export interface TeamMemberData {
  id: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  customPermissions?: string[];
  joinedAt: Date;
}

export interface SelectValueEvent {
  target?: { value?: string } | null;
  currentTarget?: {
    value?: string;
  };
}

// ── Constants ────────────────────────────────────────────────────────────────

export const PLAN_CONFIG: Record<
  string,
  { gradient: string; icon: string; label: string; color: string }
> = {
  lite: {
    gradient:
      'linear-gradient(135deg, var(--md-sys-color-secondary-container), var(--md-sys-color-secondary))',
    icon: 'shopping_cart',
    label: 'Lite',
    color: 'var(--md-sys-color-on-secondary-container)',
  },
  lite_pago: {
    gradient:
      'linear-gradient(135deg, var(--md-sys-color-tertiary-container), var(--md-sys-color-tertiary))',
    icon: 'rocket_launch',
    label: 'Lite Pago',
    color: 'var(--md-sys-color-on-tertiary-container)',
  },
  lite_plus: {
    gradient: 'linear-gradient(135deg, #7b2ff7, #4a148c)',
    icon: 'auto_awesome',
    label: 'Lite Plus',
    color: '#fff',
  },
};

export const MOBILE_COLUMN_OPTIONS = [
  { value: '1', label: '1 columna' },
  { value: '2', label: '2 columnas' },
];

export const TABLET_COLUMN_OPTIONS = [
  { value: '2', label: '2 columnas' },
  { value: '3', label: '3 columnas' },
];

export const DESKTOP_COLUMN_OPTIONS = [
  { value: '3', label: '3 columnas' },
  { value: '4', label: '4 columnas' },
];

export const GAP_OPTIONS = [
  { value: 'sm', label: 'Compacto' },
  { value: 'md', label: 'Equilibrado' },
  { value: 'lg', label: 'Aireado' },
  { value: 'xl', label: 'Muy aireado' },
];

export const SECTION_LABELS: Record<StorefrontSection['type'], string> = {
  hero: 'Portada principal',
  featured_categories: 'Categorías destacadas',
  product_grid: 'Catálogo de productos',
};

export const THEME_COLOR_FIELDS = [
  { key: 'primary', label: 'Color principal', helper: 'Botones y acciones destacadas.' },
  {
    key: 'secondary',
    label: 'Color de apoyo',
    helper: 'Píldoras, estados y elementos secundarios.',
  },
  { key: 'accent', label: 'Color de destaque', helper: 'Acentos visuales y puntos de atención.' },
] as const satisfies readonly {
  key: keyof StorefrontPalette;
  label: string;
  helper: string;
}[];

// ── Utility Functions ────────────────────────────────────────────────────────

export function getFontFamilyCSS(fontFamily: StorefrontTheme['fontFamily']): string {
  switch (fontFamily) {
    case 'google-sans':
      return "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif";
    case 'inter':
      return 'var(--font-storefront-inter), var(--mio-theme-text-font-family), sans-serif';
    case 'roboto':
      return 'var(--font-storefront-roboto), var(--mio-theme-text-font-family), sans-serif';
    case 'poppins':
      return 'var(--font-storefront-poppins), var(--mio-theme-text-font-family), sans-serif';
    default:
      return "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif";
  }
}

export function getRemainingTime(planEndDate: string | null): string | null {
  if (!planEndDate) return null;
  const end = new Date(planEndDate);
  const now = new Date();
  const diff = end.getTime() - now.getTime();
  if (diff <= 0) return 'Vencido';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    if (remainingDays === 0) {
      return `${months} mes${months !== 1 ? 'es' : ''}`;
    }
    return `${months} mes${months !== 1 ? 'es' : ''} y ${remainingDays} día${remainingDays !== 1 ? 's' : ''}`;
  }
  return `${days} día${days !== 1 ? 's' : ''} restante${days !== 1 ? 's' : ''}`;
}

export function moveSection(
  layout: StorefrontLayout,
  sectionId: string,
  direction: 'up' | 'down',
): StorefrontLayout {
  const sections = [...layout.sections].sort((left, right) => left.order - right.order);
  const currentIndex = sections.findIndex((section) => section.id === sectionId);

  if (currentIndex === -1) {
    return layout;
  }

  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= sections.length) {
    return layout;
  }

  const nextSections = [...sections];
  [nextSections[currentIndex], nextSections[targetIndex]] = [
    nextSections[targetIndex],
    nextSections[currentIndex],
  ];

  return normalizeStorefrontLayout({
    version: 1,
    sections: nextSections.map((section, index) => ({ ...section, order: index })),
  });
}

export function updateSection(
  layout: StorefrontLayout,
  sectionId: string,
  updater: (section: StorefrontSection) => StorefrontSection,
): StorefrontLayout {
  return normalizeStorefrontLayout({
    version: 1,
    sections: layout.sections.map((section) =>
      section.id === sectionId ? updater(section) : section,
    ),
  });
}

export function getSelectValue(event: SelectValueEvent): string {
  if (!event) return '';
  return event.currentTarget?.value ?? event.target?.value ?? '';
}

// ── Shared Leaf Components ───────────────────────────────────────────────────

export function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionSubtitle}>{subtitle}</p>
    </div>
  );
}

export function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {
      // Ignore clipboard errors
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <span className={styles.copyableValue}>
      <code className={styles.monoValue}>{value}</code>
      <IconButton aria-label="Copiar" onClick={handleCopy}>
        <Icon>{copied ? 'check' : 'content_copy'}</Icon>
      </IconButton>
    </span>
  );
}

export function LimitItem({
  icon,
  label,
  max,
  used,
}: {
  icon: string;
  label: string;
  max: number;
  used: number;
}) {
  const unlimited = max === -1;
  const percent = unlimited ? 1 : Math.min(used / max, 1);

  return (
    <div className={styles.limitItem}>
      <div className={styles.limitItemHeader}>
        <Icon size={18}>{icon}</Icon>
        <span className={styles.limitItemLabel}>{label}</span>
        <span className={styles.limitItemValue}>
          {unlimited ? '∞ Ilimitado' : `${used} / ${max}`}
        </span>
      </div>
      <LinearProgress value={unlimited ? 1 : percent} />
    </div>
  );
}

export function SearchPreview({
  title,
  description,
  slug,
  logoUrl,
  businessName,
  geoPlacename,
  geoRegion,
}: {
  title: string;
  description: string;
  slug: string;
  logoUrl?: string | null;
  businessName?: string;
  geoPlacename?: string;
  geoRegion?: string;
}) {
  const displayTitle = title || 'Título de tu tienda | Store Lite';
  const displayDesc =
    description ||
    'Configurá la descripción SEO para que tus clientes te encuentren más fácil en Google.';
  const locationLabel = [geoPlacename, geoRegion].filter(Boolean).join(' - ');
  const domain = businessName?.toLowerCase().replace(/\s+/g, '') || 'store.lite';

  return (
    <div className={styles.searchPreview}>
      <div className={styles.googlePreview}>
        {/* URL bar — favicon + breadcrumb estilo Google */}
        <div className={styles.googleUrl}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt=""
              className={styles.googleFaviconImg}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
                const fallback = (e.target as HTMLImageElement)
                  .nextElementSibling as HTMLElement | null;
                if (fallback) fallback.style.display = 'inline-flex';
              }}
            />
          ) : null}
          <span
            className={styles.googleFavicon}
            style={{
              display: logoUrl ? 'none' : 'inline-flex',
            }}
          >
            {(businessName || 'S')[0].toUpperCase()}
          </span>
          <span>
            {domain} › {slug}
          </span>
          <span className={styles.googleUrlArrow}>▾</span>
        </div>

        {/* Título — azul Google */}
        <a href="#" className={styles.googleTitle} onClick={(e) => e.preventDefault()}>
          {displayTitle}
        </a>

        {/* Descripción — gris, 2 líneas */}
        <p className={styles.googleSnippet}>{displayDesc}</p>

        {/* Ubicación geográfica — opcional */}
        {locationLabel && (
          <div className={styles.googleLocation}>
            <Icon style={{ fontSize: 14, lineHeight: 1 }}>location_on</Icon>
            {locationLabel}
          </div>
        )}
      </div>
    </div>
  );
}

export function CharCounter({
  current,
  limit,
  optimalRange,
}: {
  current: number;
  limit: number;
  optimalRange?: OptimalRange;
}) {
  const isOver = current > limit;
  const status = optimalRange ? getCounterStatus(current, optimalRange) : null;
  return (
    <div className={styles.charCounter}>
      <span className={`${styles.charCountText} ${isOver ? styles.charCountWarning : ''}`}>
        {isOver && (
          <Icon style={{ fontSize: 12, marginRight: 2, verticalAlign: 'middle' }}>warning</Icon>
        )}
        {current}/{limit}
      </span>
      {status && (
        <div
          className={`${styles.charCounterBar} ${
            status === 'ideal'
              ? styles.charCounterBarIdeal
              : status === 'ok'
                ? styles.charCounterBarOk
                : styles.charCounterBarPoor
          }`}
          style={{ width: `${Math.min((current / limit) * 100, 100)}%` }}
        />
      )}
    </div>
  );
}

export function DeviceCard({
  icon,
  name,
  children,
}: {
  icon: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.catalogCard}>
      <div className={styles.catalogCardHeader}>
        <Icon className={styles.catalogCardIcon}>{icon}</Icon>
        <span className={styles.catalogCardName}>{name}</span>
      </div>
      {children}
    </div>
  );
}

export function ColumnChips({
  options,
  value,
  onChange,
}: {
  options: readonly { value: string; label?: string }[];
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className={styles.catalogChipGroup}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`${styles.catalogChip} ${String(value) === opt.value ? styles.catalogChipActive : ''}`}
          onClick={() => onChange(Number(opt.value))}
        >
          {opt.label ?? opt.value}
        </button>
      ))}
    </div>
  );
}

export function CollapsibleSEOSection({
  defaultCollapsed = true,
  label = 'SEO avanzado',
  helperText = 'Tu SEO ya está optimizado. Podés ajustarlo si querés.',
  children,
}: {
  defaultCollapsed?: boolean;
  label?: string;
  helperText?: string;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className={styles.collapsibleSection}>
      <button
        type="button"
        className={styles.collapsibleHeader}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Icon
          style={{
            fontSize: 20,
            transition: 'transform 0.2s',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
          }}
        >
          chevron_right
        </Icon>
        <span className={styles.collapsibleLabel}>{label}</span>
        {!collapsed && <span className={styles.collapsibleHelper}>{helperText}</span>}
      </button>
      {!collapsed && <div className={styles.collapsibleContent}>{children}</div>}
    </div>
  );
}
