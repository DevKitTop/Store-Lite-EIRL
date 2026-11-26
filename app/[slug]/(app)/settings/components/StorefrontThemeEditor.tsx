'use client';

import {
  createDefaultStorefrontTheme,
  createRandomStorefrontTheme,
  isStorefrontColorScheme,
  normalizeStorefrontTheme,
  type StorefrontColorScheme,
  type StorefrontTheme,
} from '@/core/storefront';
import { STOREFRONT_FONT_OPTIONS } from '@/core/storefront/storefrontFontRegistry';
import type { Permission } from '@/lib/permissions/definitions';
import { AlertSnackbar, Button, Card, Icon, Select, Switch } from '@/shared/components/ui';
import { ThemeSettings } from '@/shared/components/ui/ThemeSettings';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type CSSProperties } from 'react';
import {
  clearStorefrontTheme,
  updateStorefrontDefaultScheme,
  updateStorefrontTheme,
} from '../actions';
import {
  THEME_COLOR_FIELDS,
  getFontFamilyCSS,
  getSelectValue,
  type Entitlements,
  type SelectValueEvent,
  type SettingsBusiness,
} from '../constants';
import { useSnackbarFeedback } from '../hooks/useSettingsState';
import styles from '../settings.module.css';

function getSnackbarAutoCloseDuration(color: 'success' | 'error'): number {
  return color === 'error' ? 0 : 5000;
}

export function StorefrontThemeEditor({
  business,
  entitlements,
  initialStorefrontTheme,
  initialHasCustomTheme = false,
  initialScheme,
  isOwner,
  permissions,
}: {
  business: SettingsBusiness;
  entitlements: Entitlements;
  initialStorefrontTheme: StorefrontTheme;
  initialHasCustomTheme?: boolean;
  initialScheme?: 'light' | 'dark';
  isOwner: boolean;
  permissions: Permission[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [usePlatformColors, setUsePlatformColors] = useState(!initialHasCustomTheme);
  const [storefrontTheme, setStorefrontTheme] = useState<StorefrontTheme>(() =>
    normalizeStorefrontTheme(initialStorefrontTheme),
  );
  const [scheme] = useState<StorefrontColorScheme>(initialScheme ?? 'light');
  const [defaultScheme, setDefaultScheme] = useState<'light' | 'dark'>(initialScheme ?? 'light');
  const currentConfig = storefrontTheme[scheme];
  const { feedback, showSuccess, showError, close: closeFeedback } = useSnackbarFeedback();

  // ── Dirty tracking snapshots ──
  // Captured at the same time as the state initializers so they are
  // guaranteed to match on the first render (no serialization mismatch).
  const [savedPlatformColors, setSavedPlatformColors] = useState(!initialHasCustomTheme);
  const [savedTheme, setSavedTheme] = useState<StorefrontTheme>(() =>
    normalizeStorefrontTheme(initialStorefrontTheme),
  );

  const handleDefaultSchemeChange = (event: SelectValueEvent) => {
    const next = getSelectValue(event);
    if (!isStorefrontColorScheme(next)) return;

    const previous = defaultScheme;
    setDefaultScheme(next);
    startTransition(async () => {
      const result = await updateStorefrontDefaultScheme(business.id, business.slug, next);
      if (!result.success) {
        setDefaultScheme(previous);
        showError(result.error || 'No se pudo actualizar el esquema por defecto.');
        return;
      }

      showSuccess('Esquema por defecto actualizado correctamente.');
      router.refresh();
    });
  };

  const handleSaveTheme = () => {
    closeFeedback();
    startTransition(async () => {
      let result;
      if (usePlatformColors) {
        result = await clearStorefrontTheme(business.id, business.slug);
      } else {
        result = await updateStorefrontTheme(business.id, business.slug, storefrontTheme);
      }

      if (!result.success) {
        showError(result.error || 'No se pudo guardar la apariencia pública.');
        return;
      }

      if ('storefrontTheme' in result && result.storefrontTheme) {
        const updated = normalizeStorefrontTheme(result.storefrontTheme);
        setStorefrontTheme(updated);
        setSavedTheme(updated);
      } else {
        // clearStorefrontTheme — snapshot stays in sync with the saved theme
        setSavedTheme(normalizeStorefrontTheme(storefrontTheme));
      }

      setSavedPlatformColors(usePlatformColors);
      showSuccess('La apariencia pública del storefront se actualizó correctamente.');
      router.refresh();
    });
  };

  // Dirty state: comparar contra snapshots guardados (no contra props)
  const themeChanged = JSON.stringify(storefrontTheme) !== JSON.stringify(savedTheme);
  const hasChanges =
    usePlatformColors !== savedPlatformColors || (!usePlatformColors && themeChanged);

  const handleDiscardTheme = () => {
    closeFeedback();
    setStorefrontTheme(normalizeStorefrontTheme(savedTheme));
    setUsePlatformColors(savedPlatformColors);
  };

  const canSave = isOwner || permissions.includes('storefront.edit');
  const actionsDisabled = isPending || !canSave || !hasChanges;

  return (
    <div className={styles.sectionArea}>
      <div className={styles.businessHero}>
        <div className={styles.businessHeroIcon}>
          <Icon size={28}>palette</Icon>
        </div>
        <div>
          <h2 className={styles.businessHeroTitle}>Apariencia</h2>
          <p className={styles.businessHeroSubtitle}>
            Personalizá el look de tu panel de administración y la imagen pública de tu tienda.
          </p>
        </div>
      </div>

      <Card variant="elevated" className={styles.appearanceCard} style={{ padding: 0 }}>
        <div style={{ padding: '24px 24px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
            <Icon style={{ color: 'var(--md-sys-color-primary)', fontSize: '22px' }}>
              settings_brightness
            </Icon>
            <p className={styles.appearanceSectionTitle} style={{ padding: 0, margin: 0 }}>
              Panel privado
            </p>
          </div>
          <p className={styles.appearanceSectionDesc} style={{ marginTop: '2px', padding: 0 }}>
            Elegí el modo visual y la accesibilidad que más cómodos te queden para administrar.
          </p>
        </div>
        <div className={styles.appearanceInner} style={{ padding: '0 24px 24px' }}>
          <ThemeSettings />
        </div>
      </Card>

      {!entitlements.canCustomizeStorefront ? (
        <Card variant="outlined" className={styles.upgradeBanner}>
          <div className={styles.upgradeBannerContent}>
            <Icon size={24} style={{ color: 'var(--md-sys-color-primary)' } as CSSProperties}>
              lock
            </Icon>
            <div>
              <p className={styles.upgradeBannerTitle}>Apariencia pública premium</p>
              <p className={styles.upgradeBannerText}>
                Los colores y la tipografía del storefront están disponibles en planes con
                personalización.
              </p>
            </div>
          </div>
          <Button variant="filled" onClick={() => router.push('/pricing')}>
            Mejorar Plan
          </Button>
        </Card>
      ) : (
        <>
          {/* ── Card unificada de apariencia pública ── */}
          <Card
            variant="outlined"
            className={styles.infoCard}
            style={{ padding: 0, overflow: 'hidden' }}
          >
            {/* Header + Switch */}
            <div
              style={{
                padding: '20px 24px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <p className={styles.cardLabel} style={{ padding: 0 }}>
                  Vista pública de tu tienda
                </p>
                <p className={styles.previewSupporting} style={{ marginTop: '4px', padding: 0 }}>
                  Elegí la tipografía y los colores principales que verán tus clientes.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                <span
                  style={{
                    fontSize: '14px',
                    fontWeight: 500,
                    color: 'var(--md-sys-color-on-surface)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Usar colores de plataforma
                </span>
                <Switch
                  selected={usePlatformColors}
                  onInput={(e) => {
                    const target = e.target as HTMLElement & { selected: boolean };
                    setUsePlatformColors(target.selected);
                  }}
                />
              </div>
            </div>

            {/* Default scheme — the only writer of themeMode */}
            <div style={{ padding: '0 24px 20px' }}>
              <Select
                label="Esquema que verán tus visitantes"
                value={defaultScheme}
                disabled={isPending}
                options={[
                  { value: 'light', label: 'Claro' },
                  { value: 'dark', label: 'Oscuro' },
                ]}
                onChange={handleDefaultSchemeChange}
              />
              <p className={styles.previewSupporting} style={{ padding: 0, marginTop: '4px' }}>
                Elegí el esquema con el que se abre tu tienda. No cambia el modo que usás para
                administrar.
              </p>
            </div>

            {/* Divisor */}
            <div
              style={{
                height: '1px',
                background: 'var(--md-sys-color-outline-variant)',
                margin: '0 24px',
              }}
            />

            {/* Tipografía */}
            <div
              className={usePlatformColors ? styles.disabledCard : ''}
              style={{ padding: '20px 24px 0' }}
            >
              <p className={styles.cardLabel} style={{ padding: 0 }}>
                Tipografía principal
              </p>
              <p className={styles.previewSupporting} style={{ padding: 0, marginTop: '4px' }}>
                Elegí una sola personalidad visual. Más simple, más claro, mejor mantenible.
              </p>
              <div style={{ paddingTop: '16px', paddingBottom: '4px' }}>
                <Select
                  label="Estilo de tipografía"
                  value={storefrontTheme.fontFamily}
                  disabled={usePlatformColors}
                  options={STOREFRONT_FONT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: `${option.label} · ${option.description}`,
                  }))}
                  onChange={(e: SelectValueEvent) => {
                    const fontFamilyValue = getSelectValue(e);
                    setStorefrontTheme((prev) =>
                      normalizeStorefrontTheme({
                        ...prev,
                        fontFamily: fontFamilyValue as StorefrontTheme['fontFamily'],
                      }),
                    );
                  }}
                />

                <div
                  className={styles.fontPreviewCard}
                  style={{
                    opacity: usePlatformColors ? 0.5 : 1,
                    fontFamily: usePlatformColors
                      ? 'inherit'
                      : getFontFamilyCSS(storefrontTheme.fontFamily),
                  }}
                >
                  <p className={styles.fontPreviewLabel}>Vista previa</p>
                  <p className={styles.fontPreviewText}>
                    Cada letra cuenta una historia. Este texto se ve en la tipografía{' '}
                    {STOREFRONT_FONT_OPTIONS.find((o) => o.value === storefrontTheme.fontFamily)
                      ?.label ?? ''}
                    .
                  </p>
                </div>
              </div>
            </div>

            {/* Divisor */}
            <div
              style={{
                height: '1px',
                background: 'var(--md-sys-color-outline-variant)',
                margin: '16px 24px 0',
              }}
            />

            {/* Colores */}
            <div className={usePlatformColors ? styles.disabledCard : ''}>
              <div style={{ padding: '20px 24px 0' }}>
                <p className={styles.cardLabel} style={{ padding: 0 }}>
                  Colores principales
                </p>
                <p className={styles.previewSupporting} style={{ padding: 0, marginTop: '4px' }}>
                  Partimos de la paleta base del preview de creación y desde acá la podés ajustar.
                </p>
              </div>
              <div className={styles.themeColorGrid}>
                {THEME_COLOR_FIELDS.map((field) => {
                  const colorValue = currentConfig.palette[field.key];
                  return (
                    <div key={field.key} className={styles.themeColorField}>
                      <label className={styles.themeColorLabel} htmlFor={`theme-${field.key}`}>
                        {field.label}
                      </label>
                      <p className={styles.themeColorHelper}>{field.helper}</p>
                      <div className={styles.themeColorControl}>
                        <div className={styles.themeColorSwatch}>
                          <input
                            id={`theme-${field.key}`}
                            className={styles.themeColorSwatchInput}
                            type="color"
                            disabled={usePlatformColors}
                            value={colorValue}
                            onChange={(event) =>
                              setStorefrontTheme((prev) =>
                                normalizeStorefrontTheme({
                                  ...prev,
                                  [scheme]: {
                                    ...prev[scheme],
                                    palette: {
                                      ...prev[scheme].palette,
                                      [field.key]: event.target.value,
                                    },
                                  },
                                }),
                              )
                            }
                          />
                          <div
                            className={styles.themeColorSwatchFill}
                            style={{ backgroundColor: colorValue }}
                          />
                        </div>
                        <span className={styles.themeColorCode}>
                          <span
                            className={styles.themeColorCodeDot}
                            style={{ backgroundColor: colorValue }}
                          />
                          {colorValue}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Botones de paleta */}
              <div
                style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap',
                  padding: '4px 24px 24px',
                }}
              >
                <Button
                  variant="tonal"
                  disabled={usePlatformColors}
                  onClick={() =>
                    setStorefrontTheme(
                      createRandomStorefrontTheme({ fontFamily: storefrontTheme.fontFamily }),
                    )
                  }
                >
                  <Icon slot="icon" size={20}>
                    casino
                  </Icon>
                  Combinación aleatoria
                </Button>
                <Button
                  variant="text"
                  disabled={usePlatformColors}
                  onClick={() => setStorefrontTheme(createDefaultStorefrontTheme())}
                >
                  <Icon slot="icon" size={20}>
                    restart_alt
                  </Icon>
                  Valores iniciales
                </Button>
              </div>
            </div>
          </Card>

          {/* Botones de guardado y descarte — activos solo si hay cambios */}
          <div className={styles.actionRow}>
            <Button variant="text" onClick={handleDiscardTheme} disabled={actionsDisabled}>
              Descartar cambios
            </Button>
            <Button variant="filled" onClick={handleSaveTheme} disabled={actionsDisabled}>
              <Icon slot="icon" size={20}>
                {isPending ? 'sync' : 'save'}
              </Icon>
              {isPending
                ? 'Guardando...'
                : hasChanges
                  ? 'Guardar apariencia pública'
                  : 'Sin cambios pendientes'}
            </Button>
          </div>
        </>
      )}

      <AlertSnackbar
        open={feedback.open}
        description={feedback.description}
        color={feedback.color}
        icon={feedback.icon}
        onClose={closeFeedback}
        autoCloseDuration={getSnackbarAutoCloseDuration(feedback.color)}
      />
    </div>
  );
}
