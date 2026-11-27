'use client';

import {
  createDefaultStorefrontLayout,
  normalizeStorefrontLayout,
  type GridGap,
  type ProductGridSection,
  type StorefrontLayout,
} from '@/core/storefront';
import {
  hasStorefrontCustomizationAccess,
  hasStorefrontEditPermission,
} from '@/core/storefront/storefrontCustomizationAccess';
import { claimPromotionAction } from '@/features/promotions/actions';
import type { Permission } from '@/lib/permissions/definitions';
import {
  AlertSnackbar,
  Button,
  Card,
  CircularProgress,
  Divider,
  Icon,
  IconButton,
  List,
  ListItem,
  Switch,
  TextField,
} from '@/shared/components/ui';
import { ImageCropModal } from '@/shared/components/ui/inputs/ImageCropModal';
import { buildStoreDescription, buildStoreTitle } from '@/shared/seo/buildStorefrontMeta';
import { compressImageToMaxSize } from '@/shared/utils/image';
import { getBusinessPath } from '@/shared/utils/url';
import { useParams, useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
} from 'react';
import { updateBusinessLogo } from '../../../../actions/business';
import {
  checkSlugAvailability,
  toggleBusinessActive,
  updateBusinessSEO,
  updateBusinessSlug,
  updateStorefrontLayout,
} from '../actions';
import {
  CharCounter,
  CollapsibleSEOSection,
  ColumnChips,
  CopyableValue,
  DESKTOP_COLUMN_OPTIONS,
  DeviceCard,
  GAP_OPTIONS,
  getRemainingTime,
  LimitItem,
  moveSection,
  PLAN_CONFIG,
  SearchPreview,
  SECTION_LABELS,
  TABLET_COLUMN_OPTIONS,
  updateSection,
  type Entitlements,
  type PromotionOffer,
  type SettingsBusiness,
  type SettingsClientProps,
} from '../constants';
import { useSnackbarFeedback } from '../hooks/useSettingsState';
import { ComplaintsPanel } from '../libro-reclamaciones/ComplaintsPanel';
import styles from '../settings.module.css';
import { PaymentsConfig } from './PaymentsConfig';
import { NAV_GROUPS, SettingsNav, type Section } from './SettingsNav';
import { SocialLinksSection } from './SocialLinksSection';
import { StorefrontThemeEditor } from './StorefrontThemeEditor';
import { TeamManagementPanel } from './TeamManagementPanel';

function BusinessSection({
  business,
  entitlements,
  businessLocked,
  isOwner,
  permissions,
}: {
  business: SettingsBusiness;
  entitlements: Entitlements;
  businessLocked: boolean;
  isOwner: boolean;
  permissions: Permission[];
}) {
  const router = useRouter();
  const canEditSlug = entitlements.plan !== 'lite' && !businessLocked;
  const isLitePlan = entitlements.plan === 'lite';
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const appDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000';
  const SLUG_MIN = 10;
  const SLUG_MAX = 30;

  // Slug availability check
  const [slugAvailability, setSlugAvailability] = useState<
    'idle' | 'checking' | 'available' | 'taken'
  >('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  const checkAvailability = useCallback(
    (slug: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);

      if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || slug === business.slug) {
        setSlugAvailability('idle');
        return;
      }

      setSlugAvailability('checking');
      debounceRef.current = setTimeout(async () => {
        const res = await checkSlugAvailability(slug, business.id);
        if (res.success) {
          setSlugAvailability(res.available ? 'available' : 'taken');
        } else {
          setSlugAvailability('idle');
        }
      }, 500);
    },
    [business.id, business.slug],
  );
  const [localLogoUrl, setLocalLogoUrl] = useState<string | null>(null);
  const [avatarToCrop, setAvatarToCrop] = useState<File | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  const AVATAR_MAX_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError(null);

    // Validate file type
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError('Solo se permiten imágenes JPG, PNG o WebP.');
      e.target.value = '';
      return;
    }

    // Validate file size
    if (file.size > AVATAR_MAX_SIZE) {
      setAvatarError(`La imagen no debe superar los 5 MB.`);
      e.target.value = '';
      return;
    }

    setAvatarToCrop(file);
    e.target.value = '';
  };

  const handleCroppedAvatar = async (file: File) => {
    setAvatarToCrop(null);
    setAvatarError(null);
    setIsUploadingAvatar(true);
    try {
      const compressedFile = await compressImageToMaxSize(file);
      const formData = new FormData();
      formData.append('file', compressedFile);
      const result = await updateBusinessLogo(business.id, business.slug, formData);
      if (result.success && result.url) {
        setLocalLogoUrl(result.url);
        router.refresh();
      } else {
        setAvatarError(result.error || 'Error al subir el avatar.');
      }
    } catch {
      setAvatarError('Error inesperado al subir el avatar.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // State for slug editing
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [newSlug, setNewSlug] = useState(business.slug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [isPendingSlug, startTransitionSlug] = useTransition();

  // Optimistic UI for active toggle
  const [optimisticIsActive, toggleOptimisticActive] = useOptimistic(
    business.isActive,
    (current) => !current,
  );
  const [isPendingActive, startTransitionActive] = useTransition();

  const handleSaveSlug = () => {
    if (newSlug === business.slug) {
      setIsEditingSlug(false);
      return;
    }

    // Client-side validation antes de mandar al server
    if (newSlug.length < SLUG_MIN || newSlug.length > SLUG_MAX) {
      setSlugError(`El slug debe tener entre ${SLUG_MIN} y ${SLUG_MAX} caracteres.`);
      return;
    }

    startTransitionSlug(async () => {
      setSlugError(null);
      const res = await updateBusinessSlug(business.id, newSlug);
      if (!res.success) {
        setSlugError(res.error || 'Error al actualizar el slug');
      } else {
        setIsEditingSlug(false);
        setSlugAvailability('idle');
        router.push(getBusinessPath(res.newSlug!, '/settings'));
      }
    });
  };

  const handleToggleActive = () => {
    startTransitionActive(async () => {
      toggleOptimisticActive(undefined); // toggle optimistically
      const res = await toggleBusinessActive(business.id, business.isActive);
      if (!res.success) {
        console.error(res.error);
        // Error handling could be a toast in the future, for now it will just revert the optimistic UI on next refresh/render
        alert(`Error: ${res.error}`);
      }
    });
  };

  return (
    <div className={styles.sectionArea}>
      <ImageCropModal
        file={avatarToCrop}
        onCancel={() => setAvatarToCrop(null)}
        onApply={(file) => void handleCroppedAvatar(file)}
      />
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>store</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>Mi Negocio</h2>
          <p className={styles.businessHeroSubtitle}>
            Toda la identidad de tu tienda en un solo lugar. Acá podés cambiar el logo, la
            descripción, la URL y el estado de tu negocio.
          </p>
        </div>
      </div>

      {isLitePlan && (
        <Card variant="outlined" className={styles.upgradeBanner}>
          <div className={styles.upgradeBannerContent}>
            <Icon size={24} style={{ color: 'var(--md-sys-color-primary)' } as React.CSSProperties}>
              lock
            </Icon>
            <div>
              <p className={styles.upgradeBannerTitle}>Funciones Premium</p>
              <p className={styles.upgradeBannerText}>
                La edición de tu URL personalizada y la visibilidad de la tienda están disponibles a
                partir del plan Lite Pago.
              </p>
            </div>
          </div>
          <Button variant="filled" onClick={() => router.push('/pricing')}>
            Sube de nivel
          </Button>
        </Card>
      )}

      {/* Profile Card cover + logo */}
      <Card variant="elevated" className={styles.profileCard}>
        {/* Cover banner */}
        {business.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={business.coverImageUrl}
            alt="Imagen de publicidad"
            className={styles.coverBanner}
          />
        ) : (
          <div className={styles.coverBannerFallback}>
            <Icon size={40}>image</Icon>
            <span>Sin imagen de publicidad</span>
          </div>
        )}

        {/* Logo + identity */}
        <div className={styles.profileRow}>
          <div
            className={styles.logoCircle}
            role="button"
            tabIndex={0}
            aria-label="Cambiar foto de perfil"
            data-uploading={isUploadingAvatar || undefined}
            onClick={() => !isUploadingAvatar && avatarInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') avatarInputRef.current?.click();
            }}
            style={{ cursor: isUploadingAvatar ? 'default' : 'pointer' } as React.CSSProperties}
          >
            {(localLogoUrl ?? business.logoUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={localLogoUrl ?? business.logoUrl!}
                alt="Logo"
                className={styles.logoImage}
              />
            ) : (
              <span className={styles.logoInitial}>{business.name.charAt(0).toUpperCase()}</span>
            )}
            <div className={styles.logoEditOverlay}>
              {isUploadingAvatar ? <CircularProgress /> : <Icon size={28}>photo_camera</Icon>}
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className={styles.logoFileInput}
              disabled={isUploadingAvatar}
              onChange={handleAvatarChange}
            />
          </div>
          <div className={styles.profileMeta}>
            <p className={styles.businessName}>{business.name}</p>
            <div className={styles.slugBadge}>
              <Icon size={14}>link</Icon>@{business.slug}
            </div>
          </div>

          <div className={styles.statusToggleContainer}>
            <div className={styles.statusLabelWrapper}>
              <span
                className={styles.statusDot}
                data-active={optimisticIsActive}
                data-pending={isPendingActive || undefined}
              />
              {isPendingActive && (
                <Icon className={styles.spinIcon} size={16}>
                  sync
                </Icon>
              )}
              <span className={styles.statusToggleLabel}>
                {isPendingActive ? 'Guardando...' : optimisticIsActive ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            <Switch
              selected={optimisticIsActive}
              onClick={handleToggleActive}
              disabled={isPendingActive || !canEditSlug}
              icons
            />
          </div>
        </div>

        {avatarError && (
          <div className={styles.avatarError}>
            <Icon size={16}>error</Icon>
            <span>{avatarError}</span>
          </div>
        )}

        {business.description && (
          <div className={styles.descriptionCard}>
            <div className={styles.descriptionInner}>
              <Icon className={styles.descriptionIcon} size={20}>
                description
              </Icon>
              <div className={styles.descriptionContent}>
                <p className={styles.descriptionLabel}>Descripción</p>
                <p className={styles.descriptionText}>{business.description}</p>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Enlace de la Tienda */}
      <Card variant="outlined" className={styles.infoCard}>
        <div className={styles.slugEditHeader}>
          <div className={styles.slugEditHeaderText}>
            <p className={styles.slugEditTitle}>URL del negocio</p>
            <p className={styles.slugCardSupporting}>
              Este es el enlace público que verán tus clientes.
            </p>
            {businessLocked && (
              <p className={styles.slugLockedNotice}>
                Este campo está bloqueado porque el negocio/producto tiene pagos registrados.
              </p>
            )}
          </div>
          {(isOwner || permissions.includes('business.edit')) && canEditSlug && !isEditingSlug && (
            <Button variant="tonal" onClick={() => setIsEditingSlug(true)}>
              <Icon slot="icon" size={20}>
                edit
              </Icon>
              Modificar URL
            </Button>
          )}
        </div>

        <div className={styles.slugEditContent}>
          {!isEditingSlug ? (
            <div className={styles.slugDisplayContainer}>
              <CopyableValue value={`${business.slug}.${appDomain}`} />
            </div>
          ) : (
            <div className={styles.slugEditor}>
              <div className={styles.slugInputWrapper}>
                <TextField
                  value={newSlug}
                  onInput={(e: React.FormEvent<HTMLInputElement>) => {
                    const val = (e.target as HTMLInputElement).value;
                    const cleanSlug = val
                      .toLowerCase()
                      .replace(/\s+/g, '-')
                      .replace(/[^a-z0-9-]/g, '');
                    setNewSlug(cleanSlug);
                    setSlugError(null);
                    checkAvailability(cleanSlug);
                  }}
                  placeholder="mi-tienda-ejemplo"
                  className={styles.slugInputStandalone}
                  disabled={isPendingSlug}
                  error={!!slugError}
                  errorText={slugError || ''}
                />
                <span className={styles.slugDomainSuffix}>.{appDomain}</span>
              </div>

              <div className={styles.slugMeta}>
                <span className={styles.slugCharCount}>
                  {newSlug.length}/{SLUG_MAX}
                </span>
                <span className={styles.slugStatusBadge} data-availability={slugAvailability}>
                  {slugAvailability === 'checking' && 'Verificando…'}
                  {slugAvailability === 'available' && '✓ Disponible'}
                  {slugAvailability === 'taken' && '✕ No disponible'}
                </span>
              </div>

              <div className={styles.slugEditActions}>
                <Button
                  variant="text"
                  onClick={() => {
                    setIsEditingSlug(false);
                    setNewSlug(business.slug);
                    setSlugError(null);
                    setSlugAvailability('idle');
                    if (debounceRef.current) clearTimeout(debounceRef.current);
                  }}
                  disabled={isPendingSlug}
                >
                  Cancelar
                </Button>
                <Button
                  variant="filled"
                  onClick={handleSaveSlug}
                  disabled={
                    isPendingSlug ||
                    newSlug === business.slug ||
                    newSlug.length < SLUG_MIN ||
                    slugAvailability !== 'available'
                  }
                >
                  Guardar
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Info del negocio */}
      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Información del registro</p>
        <List>
          <ListItem
            headline={business.storeType ?? 'Sin configurar'}
            supportingText="Tipo de tienda"
          >
            <Icon slot="start" size={20}>
              store
            </Icon>
          </ListItem>
          <Divider />
          <ListItem
            headline={
              business.country
                ? [business.country, business.city].filter(Boolean).join(', ')
                : 'Sin configurar'
            }
            supportingText="País / Ciudad"
          >
            <Icon slot="start" size={20}>
              location_on
            </Icon>
          </ListItem>
          <Divider />
          <ListItem
            headline={
              [business.departamento, business.provincia, business.distrito]
                .filter(Boolean)
                .join(', ') || 'Sin configurar'
            }
            supportingText="Ubicación"
          >
            <Icon slot="start" size={20}>
              map
            </Icon>
          </ListItem>
          <Divider />
          {business.address && (
            <>
              <ListItem headline={business.address} supportingText="Dirección">
                <Icon slot="start" size={20}>
                  home_pin
                </Icon>
              </ListItem>
              <Divider />
            </>
          )}
          <ListItem
            headline={business.email ?? 'Sin configurar'}
            supportingText="Correo electrónico"
          >
            <Icon slot="start" size={20}>
              mail
            </Icon>
          </ListItem>
          {business.whatsappNumber && (
            <>
              <Divider />
              <ListItem headline={business.whatsappNumber} supportingText="WhatsApp">
                <Icon slot="start" size={20}>
                  chat
                </Icon>
              </ListItem>
            </>
          )}
          <Divider />
          <ListItem
            headline={new Date(business.createdAt).toLocaleDateString('es-PE', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            supportingText="Registrado el"
          >
            <Icon slot="start" size={20}>
              calendar_today
            </Icon>
          </ListItem>
        </List>
      </Card>
    </div>
  );
}

function PlanSection({
  businessId,
  promotionOffer,
  entitlements,
  isOwner,
  onOpenPayments,
}: {
  businessId: string;
  promotionOffer: PromotionOffer | null;
  entitlements: Entitlements;
  isOwner: boolean;
  onOpenPayments: () => void;
}) {
  const router = useRouter();
  const params = useParams();
  const slug = params.slug as string;
  const planKey = entitlements.plan;
  const config = PLAN_CONFIG[planKey as keyof typeof PLAN_CONFIG] ?? PLAN_CONFIG.lite;
  const remainingTime = getRemainingTime(entitlements.planEndDate);
  const offerEndDate = promotionOffer?.planEndDate
    ? new Date(promotionOffer.planEndDate).toLocaleDateString('es-PE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;
  const [isClaiming, startClaimTransition] = useTransition();
  const { feedback, showSuccess, showError, close: closeFeedback } = useSnackbarFeedback();

  const handleClaimPromotion = () => {
    startClaimTransition(async () => {
      const result = await claimPromotionAction({ businessId });
      if (result.success) {
        showSuccess('¡Listo! Tu período gratis de Lite Pago ya está activo.');
        router.refresh();
      } else {
        showError(result.error ?? 'No se pudo reclamar la oferta.');
      }
    });
  };

  const features = [
    {
      label: 'Gateway de pago',
      detail: 'Cobrá con Yape, Plin y tarjeta de crédito/débito',
      enabled: entitlements.hasPaymentGateway,
      icon: 'payments',
    },
    {
      label: 'Productos en catálogo',
      detail:
        entitlements.maxProducts === -1
          ? '∞ Ilimitados'
          : `Hasta ${entitlements.maxProducts} productos`,
      enabled: true,
      icon: 'inventory_2',
    },
    {
      label: 'Importación masiva',
      detail: 'Subí productos desde Excel/CSV en lotes',
      enabled: entitlements.canImportProducts,
      icon: 'upload',
    },
    {
      label: 'Storefront personalizable',
      detail: 'Colores, tipografía y layout de tu tienda',
      enabled: entitlements.canCustomizeStorefront,
      icon: 'tune',
    },
    {
      label: 'Chat con clientes',
      detail: 'Respondé consultas de tus clientes en tiempo real',
      enabled: entitlements.chatEnabled,
      icon: 'chat',
    },
    {
      label: 'Dashboard de métricas',
      detail: 'Ventas, visitas y rendimiento en tiempo real',
      enabled: entitlements.dashboardEnabled,
      icon: 'bar_chart',
    },
    {
      label: 'SEO avanzado',
      detail: 'Meta tags, JSON-LD y sitemap automático',
      enabled: entitlements.seoEnabled,
      icon: 'search',
    },
    {
      label: 'Asistente de IA',
      detail: 'Generación de contenido y respuestas inteligentes',
      enabled: entitlements.canUseAIAssistant,
      icon: 'auto_awesome',
    },
    {
      label: 'Equipo',
      detail:
        entitlements.maxTeamMembers === -1
          ? 'Miembros ilimitados'
          : `Hasta ${entitlements.maxTeamMembers} miembros`,
      enabled: true,
      icon: 'group',
    },
  ];

  // Feature chips for hero — top 3 enabled features
  const heroFeatures = features
    .filter((f) => f.enabled)
    .slice(0, 3)
    .map((f) => ({ label: f.label, icon: f.icon }));

  return (
    <div className={styles.sectionArea}>
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>workspace_premium</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>Plan y Límites</h2>
          <p className={styles.businessHeroSubtitle}>Tu plan actual y todo lo que incluye.</p>
        </div>
      </div>

      {/* Hero plan — llamativo según el plan */}
      <div className={styles.planHero} style={{ background: config.gradient, color: config.color }}>
        <span className={styles.planHeroDecoration}>
          <Icon style={{ fontSize: 'inherit' }}>{config.icon}</Icon>
        </span>

        <div className={styles.planHeroBody}>
          <div className={styles.planHeroTop}>
            <div className={styles.planIconCircle}>
              <Icon size={32}>{config.icon}</Icon>
            </div>
            <div className={styles.planHeroInfo}>
              <p className={styles.planHeroLabel}>Plan activo</p>
              <p className={styles.planHeroName}>{config.label}</p>
            </div>
          </div>

          {heroFeatures.length > 0 && (
            <div className={styles.planHeroFeatures}>
              {heroFeatures.map((feat) => (
                <span key={feat.label} className={styles.planHeroFeatureChip}>
                  <Icon size={14}>{feat.icon}</Icon>
                  {feat.label}
                </span>
              ))}
            </div>
          )}
        </div>

        <span
          className={`${styles.planHeroBadge} ${!entitlements.isActive ? styles.planHeroBadgeInactive : ''}`}
        >
          <Icon size={16}>{entitlements.isActive ? 'check_circle' : 'pause_circle'}</Icon>
          {entitlements.isActive ? remainingTime || 'Al día' : 'Inactivo'}
        </span>
      </div>

      {promotionOffer && isOwner && (
        <Card variant="elevated" className={styles.planFeaturesCard}>
          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Icon size={22}>card_giftcard</Icon>
              <h3 style={{ margin: 0, fontSize: '16px' }}>{promotionOffer.name}</h3>
            </div>

            {promotionOffer.state === 'available' && (
              <>
                <p style={{ margin: '12px 0 0', fontSize: '14px', lineHeight: 1.6 }}>
                  Tenés {promotionOffer.durationDays} días de Lite Pago sin cobro ni tarjeta.
                  Reclamalo cuando quieras.
                </p>
                <p style={{ margin: '8px 0 0', fontSize: '12px', lineHeight: 1.6, opacity: 0.8 }}>
                  Al vencer volvés a Lite: el catálogo queda en 50 productos, los excedentes se
                  ocultan (no se borran) y el dashboard se desactiva. Te avisamos 5 días antes.
                </p>
                <div style={{ marginTop: '16px' }}>
                  <Button variant="filled" disabled={isClaiming} onClick={handleClaimPromotion}>
                    <Icon slot="icon" size={20}>
                      redeem
                    </Icon>
                    {isClaiming ? 'Reclamando…' : 'Reclamar ahora'}
                  </Button>
                </div>
              </>
            )}

            {promotionOffer.state === 'active' && (
              <>
                <p style={{ margin: '12px 0 0', fontSize: '14px', lineHeight: 1.6 }}>
                  Te quedan {promotionOffer.daysRemaining ?? 0} días de Lite Pago. Terminá el
                  checkout en Pagos para activar tu gateway de Cobros.
                </p>
                <p style={{ margin: '8px 0 0', fontSize: '12px', lineHeight: 1.6, opacity: 0.8 }}>
                  Período gratis hasta {offerEndDate ?? 'la fecha de vencimiento'}. Revisá el
                  checklist de Culqi en Pagos. Al vencer volvés a Lite: el catálogo queda en 50
                  productos, los excedentes se ocultan (no se borran) y el dashboard se desactiva.
                  Te avisamos 5 días antes.
                </p>
                <div style={{ marginTop: '12px' }}>
                  <Button variant="text" onClick={onOpenPayments}>
                    <Icon slot="icon" size={20}>
                      payments
                    </Icon>
                    Ir a Pagos y ver checklist de Culqi
                  </Button>
                </div>
              </>
            )}

            {promotionOffer.state === 'used' && (
              <p style={{ margin: '12px 0 0', fontSize: '14px', lineHeight: 1.6 }}>
                Ya usaste esta oferta de bienvenida. Si querés seguir con Lite Pago, elegí un plan
                en Cambiar plan.
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Features — layout limpio sin chips/buttons */}
      <Card variant="elevated" className={styles.planFeaturesCard}>
        <div className={styles.teamMembersHeader}>
          <span className={styles.teamMembersTitle}>Funcionalidades incluidas</span>
        </div>
        {features.map((feat, i) => (
          <div key={feat.label}>
            {i > 0 && <div className={styles.planFeatureDivider} />}
            <div
              className={`${styles.planFeatureItem} ${!feat.enabled ? styles.planFeatureDisabled : ''}`}
            >
              <div
                className={`${styles.planFeatureIcon} ${!feat.enabled ? styles.planFeatureIconDisabled : ''}`}
              >
                <Icon size={20}>{feat.icon}</Icon>
              </div>
              <div className={styles.planFeatureBody}>
                <span className={styles.planFeatureLabel}>{feat.label}</span>
                <span className={styles.planFeatureDesc}>{feat.detail}</span>
              </div>
              <div className={styles.planFeatureStatus}>
                <Icon
                  size={20}
                  style={{
                    color: feat.enabled
                      ? 'var(--md-sys-color-primary)'
                      : 'var(--md-sys-color-outline-variant)',
                  }}
                >
                  {feat.enabled ? 'check_circle' : 'cancel'}
                </Icon>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {/* Limits */}
      <Card variant="elevated" className={styles.planLimitsCard}>
        <div className={styles.teamMembersHeader}>
          <span className={styles.teamMembersTitle}>Límites del plan</span>
        </div>
        <div className={styles.limitsContainer}>
          <LimitItem
            icon="inventory_2"
            label="Productos en catálogo"
            max={entitlements.maxProducts}
            used={entitlements.productCount}
          />
          <Divider />
          <LimitItem
            icon="group"
            label="Miembros del equipo"
            max={entitlements.maxTeamMembers}
            used={entitlements.memberCount}
          />
        </div>
      </Card>

      <div className={styles.actionRow}>
        <Button variant="filled" onClick={() => router.push(`/pricing?slug=${slug}`)}>
          <Icon slot="icon" size={21}>
            upgrade
          </Icon>
          Cambiar plan
        </Button>
      </div>

      <AlertSnackbar
        open={feedback.open}
        description={feedback.description}
        color={feedback.color}
        icon={feedback.icon}
        onClose={closeFeedback}
      />
    </div>
  );
}

function LegalSection({
  business,
  isOwner: _isOwner,
  permissions,
  preferences,
}: {
  business: SettingsBusiness;
  isOwner: boolean;
  permissions: Permission[];
  preferences: Record<string, unknown> | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { feedback, showSuccess, showError, close: closeFeedback } = useSnackbarFeedback();

  const prefs = preferences ?? {};
  const initialForm = {
    termsContent: (prefs.termsContent as string) ?? '',
    returnsContent: (prefs.returnsContent as string) ?? '',
    complaintContactEmail: (prefs.complaintContactEmail as string) ?? '',
  };
  const [formData, setFormData] = useState(initialForm);
  const initialRef = useRef(initialForm);
  const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialRef.current);
  const canSave = _isOwner || permissions.includes('legal.edit');

  const handleSave = () => {
    startTransition(async () => {
      const { saveLegalContent } = await import('@/features/legal/actions');
      const res = await saveLegalContent(business.id, business.slug, {
        termsContent: formData.termsContent || null,
        returnsContent: formData.returnsContent || null,
        complaintContactEmail: formData.complaintContactEmail || null,
      });
      if (res.success) {
        showSuccess('Contenido legal guardado correctamente.');
        router.refresh();
      } else {
        showError(res.error ?? 'Error al guardar el contenido legal.');
      }
    });
  };

  return (
    <div className={styles.sectionArea}>
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>gavel</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>Información Legal</h2>
          <p className={styles.businessHeroSubtitle}>
            Datos tributarios del negocio, representante legal y documentos obligatorios para la
            tienda.
          </p>
        </div>
      </div>

      {/* ── Tax Info Card (existing, unchanged) ── */}
      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Datos tributarios</p>
        <List>
          <ListItem headline="RUC / Tax ID" supportingText={business.taxId ?? 'Sin configurar'}>
            <Icon slot="start" size={20}>
              badge
            </Icon>
          </ListItem>
          <Divider />
          <ListItem
            headline="Tipo de persona"
            supportingText={(() => {
              if (!business.personType) return 'Sin configurar';
              return business.personType === 'natural' ? 'Persona Natural' : 'Persona Jurídica';
            })()}
          >
            <Icon slot="start" size={20}>
              person
            </Icon>
          </ListItem>
        </List>
      </Card>

      {/* ── Legal Representative Card ── */}
      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Representante legal</p>
        <List>
          <ListItem headline="Nombre" supportingText={business.legalRepName ?? 'Sin configurar'}>
            <Icon slot="start" size={20}>
              manage_accounts
            </Icon>
          </ListItem>
          <Divider />
          <ListItem
            headline="Cargo / Rol"
            supportingText={business.legalRepRole ?? 'Sin configurar'}
          >
            <Icon slot="start" size={20}>
              work
            </Icon>
          </ListItem>
          <Divider />
          <ListItem headline="Teléfono" supportingText={business.legalRepPhone ?? 'Sin configurar'}>
            <Icon slot="start" size={20}>
              phone
            </Icon>
          </ListItem>
          <Divider />
          <ListItem headline="Correo" supportingText={business.legalRepEmail ?? 'Sin configurar'}>
            <Icon slot="start" size={20}>
              alternate_email
            </Icon>
          </ListItem>
        </List>
      </Card>

      {/* ── Complaint Contact Email Card ── */}
      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Contacto para Reclamos</p>
        <div style={{ padding: '0 24px 24px' }}>
          <TextField
            label="Email de contacto para reclamos"
            type="email"
            value={formData.complaintContactEmail}
            placeholder="reclamos@tutienda.pe"
            onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({
                ...formData,
                complaintContactEmail: (e.target as HTMLInputElement).value,
              })
            }
            supportingText="Se muestra en la página pública del Libro de Reclamaciones. Dejalo vacío si no querés mostrarlo."
          >
            <Icon slot="leading-icon">mail</Icon>
          </TextField>
        </div>
      </Card>

      {/* ── Legal Documents Card ── */}
      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Documentos legales de la tienda</p>
        <p className={styles.previewSupporting} style={{ padding: '0 24px', margin: 0 }}>
          Estos textos se muestran en las páginas públicas de tu tienda. Son obligatorios para
          operar con Culqi y cumplir con la normativa peruana.
        </p>

        <div className={styles.metaFields}>
          {/* Términos y Condiciones */}
          <div>
            <TextField
              label="Términos y Condiciones"
              type="textarea"
              rows={6}
              value={formData.termsContent}
              placeholder="Escribí los términos y condiciones de tu tienda..."
              onInput={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setFormData({ ...formData, termsContent: e.target.value })
              }
              supportingText="Se muestra en /{slug}/terminos. Dejalo vacío para ocultar la página."
            >
              <Icon slot="leading-icon">description</Icon>
            </TextField>
            <CharCounter current={formData.termsContent.length} limit={10000} />
          </div>

          <Divider />

          {/* Política de Devoluciones */}
          <div>
            <TextField
              label="Política de Devoluciones"
              type="textarea"
              rows={6}
              value={formData.returnsContent}
              placeholder="Escribí la política de devoluciones de tu tienda..."
              onInput={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setFormData({ ...formData, returnsContent: e.target.value })
              }
              supportingText="Se muestra en /{slug}/devoluciones. Dejalo vacío para ocultar la página."
            >
              <Icon slot="leading-icon">undo</Icon>
            </TextField>
            <CharCounter current={formData.returnsContent.length} limit={10000} />
          </div>
        </div>
      </Card>

      {/* ── Save Button ── */}
      <div className={styles.actionRow}>
        <Button
          variant="filled"
          onClick={handleSave}
          disabled={isPending || !canSave || !hasChanges}
        >
          <Icon slot="icon" size={21}>
            {isPending ? 'sync' : 'save'}
          </Icon>
          {isPending
            ? 'Guardando...'
            : !canSave
              ? 'Sin permiso'
              : !hasChanges
                ? 'Sin cambios pendientes'
                : 'Guardar documentos legales'}
        </Button>
      </div>

      <AlertSnackbar
        open={feedback.open}
        description={feedback.description}
        color={feedback.color}
        icon={feedback.icon}
        onClose={closeFeedback}
      />
    </div>
  );
}

function StorefrontSectionEditor({
  business,
  entitlements,
  initialStorefrontLayout,
  isOwner,
  permissions,
}: {
  business: SettingsBusiness;
  entitlements: Entitlements;
  initialStorefrontLayout: StorefrontLayout;
  isOwner: boolean;
  permissions: Permission[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const { feedback, showSuccess, showError, close: closeFeedback } = useSnackbarFeedback();
  const [layout, setLayout] = useState<StorefrontLayout>(
    normalizeStorefrontLayout(initialStorefrontLayout),
  );

  // Track changes vs. initial normalized state
  const initialRef = useRef<StorefrontLayout>(normalizeStorefrontLayout(initialStorefrontLayout));
  const hasChanges = JSON.stringify(layout) !== JSON.stringify(initialRef.current);
  const canSave = isOwner || permissions.includes('storefront.edit');

  const productGridSection =
    layout.sections.find(
      (section): section is ProductGridSection => section.type === 'product_grid',
    ) ??
    createDefaultStorefrontLayout().sections.find(
      (section): section is ProductGridSection => section.type === 'product_grid',
    )!;

  const updateGridConfig = <K extends keyof ProductGridSection['config']>(
    key: K,
    value: ProductGridSection['config'][K],
  ) => {
    setLayout((prev) =>
      updateSection(prev, 'product_grid', (section) =>
        section.type === 'product_grid'
          ? {
              ...section,
              config: {
                ...section.config,
                [key]: value,
              },
            }
          : section,
      ),
    );
  };

  const updateGridColumns = (breakpoint: 'mobile' | 'tablet' | 'desktop', value: number) => {
    const nextColumns = {
      ...productGridSection.config.columns,
      [breakpoint]: value,
    };

    updateGridConfig('columns', nextColumns as ProductGridSection['config']['columns']);
  };

  const updateGridGap = (breakpoint: 'mobile' | 'tablet' | 'desktop', value: GridGap) => {
    updateGridConfig('gap', {
      ...productGridSection.config.gap,
      [breakpoint]: value,
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateStorefrontLayout(business.id, business.slug, layout);

      if (!result.success) {
        showError(result.error || 'No se pudo guardar la configuración de la tienda.');
        return;
      }

      setLayout(result.layout ? normalizeStorefrontLayout(result.layout) : layout);
      showSuccess('La vista pública de tu tienda se actualizó correctamente.');
      router.refresh();
    });
  };

  if (!entitlements.canCustomizeStorefront) {
    return (
      <div className={styles.sectionArea}>
        <div className={styles.businessHero}>
          <div className={styles.businessHeroIcon}>
            <Icon size={28}>storefront</Icon>
          </div>
          <div>
            <h2 className={styles.businessHeroTitle}>Storefront</h2>
            <p className={styles.businessHeroSubtitle}>
              Organizá la página pública de tu tienda de una forma simple y segura.
            </p>
          </div>
        </div>
        <Card variant="outlined" className={styles.upgradeBanner}>
          <div className={styles.upgradeBannerContent}>
            <Icon size={24} style={{ color: 'var(--md-sys-color-primary)' } as CSSProperties}>
              lock
            </Icon>
            <div>
              <p className={styles.upgradeBannerTitle}>Builder restringido por bloques</p>
              <p className={styles.upgradeBannerText}>
                Esta configuración está disponible en planes con personalización del storefront.
              </p>
            </div>
          </div>
          <Button variant="filled" onClick={() => router.push('/pricing')}>
            Mejorar Plan
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.sectionArea}>
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>storefront</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>Storefront</h2>
          <p className={styles.businessHeroSubtitle}>
            Organizá la página pública de tu tienda de una forma simple y segura.
          </p>
        </div>
      </div>

      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Bloques visibles en tu página</p>
        <p className={styles.previewSupporting}>
          Elegí qué partes mostrar y en qué orden aparecen.
        </p>
        <div className={styles.storefrontBlockList}>
          {layout.sections.map((section, index) => (
            <div key={section.id} className={styles.storefrontBlockRow}>
              <span className={styles.storefrontBlockDrag}>≡</span>
              <span className={styles.storefrontBlockName}>{SECTION_LABELS[section.type]}</span>
              <div className={styles.storefrontBlockActions}>
                <Switch
                  selected={section.visible}
                  onClick={() =>
                    setLayout((prev) =>
                      updateSection(prev, section.id, (current) => ({
                        ...current,
                        visible: !current.visible,
                      })),
                    )
                  }
                />
                <IconButton
                  aria-label="Subir bloque"
                  disabled={index === 0}
                  onClick={() => setLayout((prev) => moveSection(prev, section.id, 'up'))}
                >
                  <Icon>arrow_upward</Icon>
                </IconButton>
                <IconButton
                  aria-label="Bajar bloque"
                  disabled={index === layout.sections.length - 1}
                  onClick={() => setLayout((prev) => moveSection(prev, section.id, 'down'))}
                >
                  <Icon>arrow_downward</Icon>
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Configuración del catálogo</p>
        <p className={styles.previewSupporting}>
          Definí cuántos productos se ven por fila y el espaciado entre ellos para cada tipo de
          pantalla.
        </p>

        <div className={styles.catalogSection}>
          {/* ── Productos por fila ── */}
          <div className={styles.catalogRow}>
            <h4 className={styles.catalogRowTitle}>Productos por fila</h4>
            <p className={styles.catalogRowDesc}>
              Cantidad de columnas visibles según el dispositivo.
            </p>
            <div className={styles.catalogCards}>
              <DeviceCard icon="phone_android" name="Celular">
                <span className={styles.catalogFixedValue}>
                  {productGridSection.config.columns.mobile}
                </span>
              </DeviceCard>

              <DeviceCard icon="tablet" name="Tablet">
                <ColumnChips
                  options={TABLET_COLUMN_OPTIONS}
                  value={productGridSection.config.columns.tablet}
                  onChange={(v) => updateGridColumns('tablet', v)}
                />
              </DeviceCard>

              <DeviceCard icon="desktop_windows" name="Computadora">
                <ColumnChips
                  options={DESKTOP_COLUMN_OPTIONS}
                  value={productGridSection.config.columns.desktop}
                  onChange={(v) => updateGridColumns('desktop', v)}
                />
              </DeviceCard>
            </div>
          </div>

          {/* ── Espaciado ── */}
          <div className={styles.catalogRow}>
            <h4 className={styles.catalogRowTitle}>Espaciado</h4>
            <p className={styles.catalogRowDesc}>Separación entre cada producto en la grilla.</p>
            <div className={styles.catalogCards}>
              {(['mobile', 'tablet', 'desktop'] as const).map((bp) => (
                <DeviceCard
                  key={bp}
                  icon={
                    bp === 'mobile'
                      ? 'phone_android'
                      : bp === 'tablet'
                        ? 'tablet'
                        : 'desktop_windows'
                  }
                  name={bp === 'mobile' ? 'Celular' : bp === 'tablet' ? 'Tablet' : 'Computadora'}
                >
                  <select
                    className={styles.catalogSelect}
                    value={productGridSection.config.gap[bp]}
                    onChange={(e) => updateGridGap(bp, e.target.value as GridGap)}
                  >
                    {GAP_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </DeviceCard>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <div className={styles.actionRow}>
        <Button
          variant="filled"
          onClick={handleSave}
          disabled={isPending || !canSave || !hasChanges}
        >
          <Icon slot="icon" size={20}>
            {isPending ? 'sync' : 'save'}
          </Icon>
          {isPending
            ? 'Guardando...'
            : !canSave
              ? 'Sin permiso para guardar'
              : !hasChanges
                ? 'Sin cambios pendientes'
                : 'Guardar cambios'}
        </Button>
      </div>

      <AlertSnackbar
        open={feedback.open}
        description={feedback.description}
        color={feedback.color}
        icon={feedback.icon}
        onClose={closeFeedback}
      />
    </div>
  );
}
function SEOSection({
  business,
  entitlements,
  isOwner,
  permissions,
}: {
  business: SettingsBusiness;
  entitlements: Entitlements;
  isOwner: boolean;
  permissions: Permission[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const autoTitle = buildStoreTitle(business);
  const autoDescription = buildStoreDescription(business);
  const initialForm = {
    seoTitle: business.seoTitle ?? autoTitle,
    seoDescription: business.seoDescription ?? autoDescription,
    seoKeywords: business.seoKeywords?.join(', ') || '',
    latitude: business.latitude || '',
    longitude: business.longitude || '',
    geoRegion: business.geoRegion || '',
    geoPlacename: business.geoPlacename || '',
  };
  const [formData, setFormData] = useState(initialForm);
  const initialRef = useRef(initialForm);
  const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialRef.current);
  const canSave = isOwner || permissions.includes('seo.edit');

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateBusinessSEO(business.id, {
        ...formData,
        seoKeywords: formData.seoKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      });
      if (res.success) {
        router.refresh();
      } else {
        alert(res.error);
      }
    });
  };

  if (!entitlements.seoEnabled) {
    return (
      <div className={styles.sectionArea}>
        <div className={styles.businessHero}>
          <div className={styles.businessHeroIcon}>
            <Icon size={28}>travel_explore</Icon>
          </div>
          <div>
            <h2 className={styles.businessHeroTitle}>SEO y Ubicación</h2>
            <p className={styles.businessHeroSubtitle}>
              Optimizá cómo aparece tu tienda en Google y mapas.
            </p>
          </div>
        </div>
        <Card variant="outlined" className={styles.upgradeBanner}>
          <div className={styles.upgradeBannerContent}>
            <Icon size={24} style={{ color: 'var(--md-sys-color-primary)' } as React.CSSProperties}>
              lock
            </Icon>
            <div>
              <p className={styles.upgradeBannerTitle}>SEO Premium</p>
              <p className={styles.upgradeBannerText}>
                Las herramientas de SEO avanzado, meta-tags personalizadas y ubicación geográfica
                están disponibles en planes superiores.
              </p>
            </div>
          </div>
          <Button variant="filled" onClick={() => router.push('/pricing')}>
            Mejorar Plan
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className={styles.sectionArea}>
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>travel_explore</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>SEO y Ubicación</h2>
          <p className={styles.businessHeroSubtitle}>
            Configurá cómo aparece tu tienda en buscadores y mapas para atraer más clientes.
          </p>
        </div>
      </div>

      <SearchPreview
        title={formData.seoTitle}
        description={formData.seoDescription}
        slug={business.slug}
        logoUrl={business.logoUrl}
        businessName={business.name}
        geoPlacename={formData.geoPlacename}
        geoRegion={formData.geoRegion}
      />

      <CollapsibleSEOSection defaultCollapsed={true}>
        <Card variant="outlined" className={styles.infoCard}>
          <p className={styles.cardLabel}>Metadata de Búsqueda</p>
          <div className={styles.metaFields}>
            <div>
              <TextField
                label="Título SEO"
                value={formData.seoTitle}
                placeholder="Ej: Mi Tienda Online | Store Lite"
                onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, seoTitle: e.target.value })
                }
                supportingText="Entre 50 y 60 caracteres. Aparece como el título azul en Google."
              >
                <Icon slot="leading-icon">title</Icon>
              </TextField>
              <CharCounter
                current={formData.seoTitle.length}
                limit={60}
                optimalRange={{ min: 50, max: 60 }}
              />
            </div>

            <div>
              <TextField
                label="Descripción SEO"
                type="textarea"
                rows="3"
                value={formData.seoDescription}
                placeholder="Ej: Comprá productos únicos en Mi Tienda — envíos a todo el país."
                onInput={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setFormData({ ...formData, seoDescription: e.target.value })
                }
                supportingText="Máximo 160 caracteres. Aparece como el texto gris debajo del título en Google."
              >
                <Icon slot="leading-icon">description</Icon>
              </TextField>
              <CharCounter
                current={formData.seoDescription.length}
                limit={160}
                optimalRange={{ min: 150, max: 160, lowerOffset: 30 }}
              />
            </div>

            <Divider />

            <div>
              <TextField
                label="Keywords (etiquetas clave)"
                value={formData.seoKeywords}
                placeholder="ropa, zapatos, ofertas, envíos"
                onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, seoKeywords: e.target.value })
                }
                supportingText="Palabras clave separadas por comas. Ayudan a Google a entender el contenido de tu tienda."
              >
                <Icon slot="leading-icon">key</Icon>
              </TextField>
            </div>
          </div>
        </Card>
      </CollapsibleSEOSection>

      <Card variant="outlined" className={styles.infoCard}>
        <p className={styles.cardLabel}>Posicionamiento Local (GPS)</p>
        <p className={styles.previewSupporting} style={{ padding: '0 24px', margin: 0 }}>
          Estas coordenadas y datos geográficos ayudan a Google a mostrar tu tienda en resultados
          locales y Google Maps.
        </p>
        <div className={styles.formGrid}>
          <div className={styles.twoColRow} style={{ gridColumn: '1 / -1' }}>
            <TextField
              label="Latitud"
              value={formData.latitude}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, latitude: e.target.value })
              }
              placeholder="-16.398764"
              supportingText="Coordenada sur o norte de tu tienda."
            >
              <Icon slot="leading-icon">location_on</Icon>
            </TextField>
            <TextField
              label="Longitud"
              value={formData.longitude}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, longitude: e.target.value })
              }
              placeholder="-71.535004"
              supportingText="Coordenada este u oeste de tu tienda."
            >
              <Icon slot="leading-icon">explore</Icon>
            </TextField>
          </div>

          <div className={styles.twoColRow} style={{ gridColumn: '1 / -1' }}>
            <TextField
              label="Región Geo (ISO)"
              value={formData.geoRegion}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, geoRegion: e.target.value })
              }
              placeholder="PE-ARE"
              supportingText="Código ISO de la región. Ej: PE-ARE para Arequipa."
            >
              <Icon slot="leading-icon">public</Icon>
            </TextField>
            <TextField
              label="Ciudad / Localidad"
              value={formData.geoPlacename}
              onInput={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, geoPlacename: e.target.value })
              }
              placeholder="ej: Arequipa"
              supportingText="Nombre de la ciudad o localidad de tu tienda."
            >
              <Icon slot="leading-icon">apartment</Icon>
            </TextField>
          </div>
        </div>
      </Card>

      <div className={styles.actionRow}>
        <Button
          variant="filled"
          onClick={handleSave}
          disabled={isPending || !canSave || !hasChanges}
        >
          <Icon slot="icon" size={21}>
            {isPending ? 'sync' : 'save'}
          </Icon>
          {isPending
            ? 'Guardando...'
            : !canSave
              ? 'Sin permiso'
              : !hasChanges
                ? 'Sin cambios pendientes'
                : 'Guardar Configuración SEO'}
        </Button>
      </div>
    </div>
  );
}

export type { SettingsBusiness } from '../constants';

export function SettingsClient({
  business,
  entitlements,
  promotionOffer,
  initialStorefrontLayout,
  initialStorefrontTheme,
  initialHasCustomTheme = false,
  initialScheme,
  businessLocked,
  role,
  permissions,
  isOwner,
}: SettingsClientProps) {
  const canCustomizeStorefront = hasStorefrontCustomizationAccess({
    hasEditPermission: hasStorefrontEditPermission({ isOwner, permissions }),
    canCustomizeStorefrontPlan: entitlements.canCustomizeStorefront,
  });

  const navItemsWithAccess = React.useMemo(() => {
    return NAV_GROUPS.flatMap((group) =>
      group.items.map((item) => {
        let hasAccess = false;
        if (item.id === 'storefront') {
          hasAccess = canCustomizeStorefront;
        } else if (isOwner) {
          hasAccess = true;
        } else {
          switch (item.id) {
            case 'business':
              hasAccess =
                permissions.includes('business.edit') || permissions.includes('contact.edit');
              break;
            case 'appearance':
              hasAccess = permissions.includes('storefront.edit');
              break;
            case 'plan':
            case 'team':
              break;
            case 'legal':
              hasAccess = permissions.includes('legal.edit');
              break;
            case 'complaints':
              hasAccess = permissions.includes('legal.edit');
              break;
            case 'seo':
              hasAccess = permissions.includes('seo.edit');
              break;
            case 'social':
              hasAccess = permissions.includes('business.edit');
              break;
            case 'payments': {
              const isPremiumPlan = ['lite_pago', 'lite_plus'].includes(entitlements.plan);
              hasAccess = isPremiumPlan && permissions.includes('business.edit');
              break;
            }
          }
        }
        return { ...item, hasAccess };
      }),
    );
  }, [canCustomizeStorefront, isOwner, permissions, entitlements]);

  const accessibleItems = React.useMemo(
    () => navItemsWithAccess.filter((i) => i.hasAccess),
    [navItemsWithAccess],
  );
  const [active, setActive] = useState<Section>(
    accessibleItems.length > 0 ? accessibleItems[0].id : 'business',
  );
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`settings_tab_${business.id}`);
      if (saved && accessibleItems.some((i) => i.id === saved)) {
        setActive(saved as Section);
      }
    }
  }, [business.id, accessibleItems]);

  useEffect(() => {
    if (isMounted && typeof window !== 'undefined') {
      localStorage.setItem(`settings_tab_${business.id}`, active);
    }
  }, [active, business.id, isMounted]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className={styles.root}>
        <SettingsNav items={navItemsWithAccess} active={active} onChange={setActive} />

        {/* Content area */}
        <main className={styles.content}>
          <div className={styles.contentInner}>
            {accessibleItems.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  flex: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: '60vh',
                }}
              >
                <Card
                  variant="outlined"
                  style={{ padding: '3rem', textAlign: 'center', maxWidth: '400px' }}
                >
                  <Icon
                    size={48}
                    style={
                      {
                        color: 'var(--md-sys-color-primary)',
                        marginBottom: '1rem',
                      } as React.CSSProperties
                    }
                  >
                    lock_person
                  </Icon>
                  <h2
                    style={{
                      fontSize: '1.5rem',
                      marginBottom: '0.5rem',
                      color: 'var(--md-sys-color-on-surface)',
                    }}
                  >
                    Acceso restringido
                  </h2>
                  <p style={{ color: 'var(--md-sys-color-on-surface-variant)', lineHeight: '1.5' }}>
                    No tienes permisos para ver o editar las configuraciones de este negocio.
                  </p>
                </Card>
              </div>
            ) : (
              <>
                {active === 'business' && (
                  <BusinessSection
                    business={business}
                    entitlements={entitlements}
                    businessLocked={businessLocked}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'appearance' && (
                  <StorefrontThemeEditor
                    business={business}
                    entitlements={entitlements}
                    initialStorefrontTheme={initialStorefrontTheme}
                    initialHasCustomTheme={initialHasCustomTheme}
                    initialScheme={initialScheme}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'storefront' && canCustomizeStorefront && (
                  <StorefrontSectionEditor
                    business={business}
                    entitlements={entitlements}
                    initialStorefrontLayout={initialStorefrontLayout}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'plan' && (
                  <PlanSection
                    businessId={business.id}
                    promotionOffer={promotionOffer ?? null}
                    entitlements={entitlements}
                    isOwner={isOwner}
                    onOpenPayments={() => setActive('payments')}
                  />
                )}
                {active === 'team' && (
                  <TeamManagementPanel
                    business={business}
                    entitlements={entitlements}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'seo' && (
                  <SEOSection
                    business={business}
                    entitlements={entitlements}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'legal' && (
                  <LegalSection
                    business={business}
                    isOwner={isOwner}
                    permissions={permissions}
                    preferences={business.preferences}
                  />
                )}
                {active === 'complaints' && (
                  <ComplaintsPanel
                    businessId={business.id}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'payments' && (
                  <PaymentsConfig
                    business={business}
                    entitlements={entitlements}
                    isOwner={isOwner}
                    permissions={permissions}
                  />
                )}
                {active === 'social' && (
                  <SocialLinksSection
                    business={business}
                    isOwner={isOwner}
                    permissions={permissions}
                    whatsappNumber={business.whatsappNumber ?? ''}
                    onWhatsAppSaved={() => {
                      /* router.refresh() inside SocialLinksSection handles it */
                    }}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
