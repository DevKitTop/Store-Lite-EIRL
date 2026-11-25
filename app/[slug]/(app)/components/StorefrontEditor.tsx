'use client';

import type {
  StorefrontBackground,
  StorefrontBackgroundType,
  StorefrontColorConfig,
  StorefrontColorScheme,
  StorefrontTheme,
} from '@/core/storefront';
import { normalizeStorefrontTheme, patternToCssOverlay, randomHexColor } from '@/core/storefront';
import type { PatternCraftPattern } from '@/data/patterncraft';
import { getPatternCraftById } from '@/data/patterncraft';
import { Icon } from '@/shared/components/ui/data-display/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateStorefrontTheme } from '../settings/actions';
import { PatternBrowser } from './PatternBrowser';
import styles from './StorefrontEditor.module.css';

interface StorefrontEditorProps {
  business: { id: string; slug: string };
  storefrontTheme: StorefrontTheme;
  onThemeChange: (theme: StorefrontTheme) => void;
  onPreviewSchemeChange?: (scheme: StorefrontColorScheme | undefined) => void;
  onOpen?: () => void;
  onClose?: () => void;
  detectedColorScheme: StorefrontColorScheme;
  /** The scheme currently active on the page (from toggle or OS default). */
  currentScheme?: StorefrontColorScheme;
  /** Business default scheme from DB (themeMode). Used as initial scheme tab. */
  defaultScheme?: 'light' | 'dark';
  /** Called whenever the editor opens or closes. Lets the page know the
   *  customize editor is active so reverse theme sync can be skipped. */
  onOpenChange?: (open: boolean) => void;
}

// NOTE: Built-in overlays (dots, lines, etc.) and custom CSS textarea were removed in V2.
// PatternCraft is now the only decorative pattern option.

const FONT_OPTIONS = [
  { value: 'google-sans', label: 'Predeterminado' },
  { value: 'inter', label: 'Inter' },
  { value: 'roboto', label: 'Roboto' },
] as const;

const SCHEME_TABS: { value: StorefrontColorScheme; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];

const THEME_BG_COLORS = [
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#14b8a6',
  '#8b5cf6',
  '#ffffff',
  '#111827',
];

export function StorefrontEditor({
  business,
  storefrontTheme,
  onThemeChange,
  onPreviewSchemeChange,
  onOpen,
  onClose,
  detectedColorScheme,
  currentScheme,
  defaultScheme,
  onOpenChange,
}: StorefrontEditorProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTheme, setSavedTheme] = useState<StorefrontTheme>(() =>
    normalizeStorefrontTheme(storefrontTheme),
  );
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasChanges = useMemo(
    () => JSON.stringify(normalizeStorefrontTheme(storefrontTheme)) !== JSON.stringify(savedTheme),
    [storefrontTheme, savedTheme],
  );
  const clearFeedback = useCallback(() => {
    clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = undefined;
    setFeedback(null);
  }, []);

  // Notify the page when the editor opens/closes so reverse theme sync
  // can be skipped while the storefront is being customized.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  const [isPatternBrowserOpen, setIsPatternBrowserOpen] = useState(false);
  const [, setOverlayPending] = useState(false);
  // The scheme state (light/dark) persists across open/close cycles because
  // this component stays mounted. The user's last tab selection remains active,
  // and onPreviewSchemeChange keeps the page preview showing that scheme even
  // after the editor closes. No reset logic needed here.
  const [scheme, setScheme] = useState<StorefrontColorScheme>(defaultScheme ?? 'light');
  const panelRef = useRef<HTMLDivElement>(null);

  const currentConfig: StorefrontColorConfig = storefrontTheme[scheme];
  const bg = currentConfig.background;
  const fillType: StorefrontBackgroundType = bg?.type ?? 'solid';
  const defaultFillColors = scheme === 'dark' ? ['#0f172a'] : ['#ffffff'];
  const fillColors = bg?.colors ?? defaultFillColors;
  const fillColorCount = fillColors.length;
  const cssOverlay = bg?.cssOverlay;
  const hasPattern = !!cssOverlay?.patternId;
  // Show toggle as ON when there's any active overlay (PatternCraft or legacy built-in)
  const hasActiveOverlay = hasPattern || !!bg?.overlay;

  // ── Pattern color vs fill: if the pattern has its own background color,
  //     show a color editor for it; otherwise fill shows through ──
  const hasPatternColor = !!cssOverlay?.background;

  // Lock body scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Sync the editor's internal scheme tab to whatever scheme is active on the
  // page (from the floating toggle or OS default) whenever the editor opens.
  useEffect(() => {
    if (!open) return;
    setScheme(currentScheme ?? detectedColorScheme);
  }, [open, currentScheme, detectedColorScheme]);

  // Update the color config for the current scheme (light or dark)
  const updateConfig = useCallback(
    (configPatch: Partial<StorefrontColorConfig>) => {
      const next: StorefrontTheme = {
        ...storefrontTheme,
        [scheme]: { ...storefrontTheme[scheme], ...configPatch },
      };
      onThemeChange(normalizeStorefrontTheme(next));
    },
    [storefrontTheme, scheme, onThemeChange],
  );

  // Update top-level theme properties (fontFamily)
  const updateTheme = useCallback(
    (patch: Partial<StorefrontTheme>) => {
      onThemeChange(normalizeStorefrontTheme({ ...storefrontTheme, ...patch }));
    },
    [storefrontTheme, onThemeChange],
  );

  // ── Draft color state for smooth drag UX ──
  // Avoids calling normalizeStorefrontTheme on every pixel of color drag.
  //
  // We use refs to accumulate pending changes so that if the user drags
  // multiple colors in quick succession (e.g. primary, then secondary),
  // ALL pending changes get committed together when the debounce fires.
  const paletteRef = useRef(currentConfig.palette);
  paletteRef.current = currentConfig.palette;
  const fillColorsRef = useRef(fillColors);
  fillColorsRef.current = fillColors;

  const [draftPalette, setDraftPalette] = useState<Record<string, string> | null>(null);
  const [draftFillColors, setDraftFillColors] = useState<string[] | null>(null);
  const paletteDraftRef = useRef<Record<string, string>>({});
  const fillDraftRef = useRef<Record<number, string>>({});
  const paletteFlushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fillFlushRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const getPaletteColor = useCallback(
    (key: keyof typeof currentConfig.palette): string =>
      draftPalette?.[key] ?? currentConfig.palette[key],
    [draftPalette, currentConfig.palette],
  );

  const getFillColor = useCallback(
    (index: number): string => draftFillColors?.[index] ?? fillColors[index],
    [draftFillColors, fillColors],
  );

  // Debounced commit: writes to draft immediately, commits accumulated
  // changes to theme after a 150ms pause in dragging.
  const schedulePaletteFlush = useCallback(() => {
    clearTimeout(paletteFlushRef.current);
    paletteFlushRef.current = setTimeout(() => {
      const pending = { ...paletteDraftRef.current };
      paletteDraftRef.current = {};
      setDraftPalette(null);
      if (Object.keys(pending).length > 0) {
        const next = { ...paletteRef.current, ...pending };
        updateConfig({ palette: next });
      }
    }, 150);
  }, [updateConfig]);

  const handlePaletteChange = useCallback(
    (key: string, value: string) => {
      paletteDraftRef.current[key] = value;
      setDraftPalette((prev) => ({ ...prev, [key]: value }));
      schedulePaletteFlush();
    },
    [schedulePaletteFlush],
  );

  // ── Fill helpers ──────────────────────────────────────────────

  const setBg = useCallback(
    (patch: Partial<StorefrontBackground>) => {
      const current: StorefrontBackground = {
        type: fillType,
        colors: fillColors,
      };
      // Preserve cssOverlay (PatternCraft pattern) when changing fill colors
      if (cssOverlay) {
        current.cssOverlay = cssOverlay;
      }
      updateConfig({ background: { ...current, ...patch } });
    },
    [fillType, fillColors, cssOverlay, updateConfig],
  );

  const scheduleFillFlush = useCallback(() => {
    clearTimeout(fillFlushRef.current);
    fillFlushRef.current = setTimeout(() => {
      const pending = { ...fillDraftRef.current };
      fillDraftRef.current = {};
      setDraftFillColors(null);
      if (Object.keys(pending).length > 0) {
        const next = [...fillColorsRef.current];
        for (const [idx, color] of Object.entries(pending)) {
          next[Number(idx)] = color;
        }
        setBg({ colors: next });
      }
    }, 150);
  }, [setBg]);

  const handleFillColorChange = (index: number, color: string) => {
    fillDraftRef.current[index] = color;
    setDraftFillColors((prev) => {
      const next = prev ? [...prev] : [...fillColors];
      next[index] = color;
      return next;
    });
    scheduleFillFlush();
  };

  // ── Dirty-state actions ───────────────────────────────────────

  const cancelDebouncedDrafts = useCallback(() => {
    clearTimeout(paletteFlushRef.current);
    clearTimeout(fillFlushRef.current);
    paletteFlushRef.current = undefined;
    fillFlushRef.current = undefined;
    paletteDraftRef.current = {};
    fillDraftRef.current = {};
    setDraftPalette(null);
    setDraftFillColors(null);
  }, []);

  const discardChanges = useCallback(() => {
    cancelDebouncedDrafts();
    clearFeedback();
    onThemeChange(normalizeStorefrontTheme(savedTheme));
  }, [cancelDebouncedDrafts, clearFeedback, onThemeChange, savedTheme]);

  // Close handler — keeps the last selected preview scheme so the page
  // stays in the scheme the user was editing after the editor closes.
  const handleClose = useCallback(() => {
    if (hasChanges && !window.confirm('¿Descartar los cambios sin guardar?')) return;
    if (hasChanges) discardChanges();
    setOpen(false);
    onClose?.();
  }, [discardChanges, hasChanges, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  // ── Color removal / add (replaces [1][2][3][4] grid) ──

  const removeColorAt = (index: number) => {
    const next = fillColors.filter((_, i) => i !== index);
    const newType: StorefrontBackgroundType = next.length === 1 ? 'solid' : 'gradient';
    setBg({ type: newType, colors: next });
  };

  const addColor = () => {
    if (fillColorCount >= 4) return;
    const next = [...fillColors, randomHexColor()];
    // When creating a gradient, randomize the direction so it's immediately
    // obvious a gradient was created (vs the hardcoded 135deg default).
    const dir = Math.floor(Math.random() * 360);
    setBg({ type: 'gradient', colors: next, gradientDirection: dir });
  };

  // ── Gradient direction ────────────────────────────────────────

  const currentDirection = bg?.gradientDirection ?? 135;

  const handleRandomizeDirection = () => {
    const dir = Math.floor(Math.random() * 360);
    setBg({ gradientDirection: dir });
  };

  // ── Global actions ───────────────────────────────────────────

  const handleSave = async () => {
    if (!hasChanges || saving) return;
    clearFeedback();
    setSaving(true);
    try {
      const result = await updateStorefrontTheme(business.id, business.slug, storefrontTheme);
      if (result.success) {
        const saved =
          'storefrontTheme' in result && result.storefrontTheme
            ? normalizeStorefrontTheme(result.storefrontTheme)
            : normalizeStorefrontTheme(storefrontTheme);
        setSavedTheme(saved);
        setFeedback({ message: 'Guardado correctamente' });
        feedbackTimeoutRef.current = setTimeout(clearFeedback, 3000);
      } else {
        setFeedback({ message: result.error || 'Error al guardar', error: true });
      }
    } catch {
      setFeedback({ message: 'Error inesperado', error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    updateConfig({ background: undefined });
  };

  const handleRandom = () => {
    // Randomiza colores de relleno y dirección del gradiente.
    // El patrón PatternCraft se mantiene igual.
    const next: StorefrontBackground = {
      type: fillType,
      colors: fillColors.map(() => randomHexColor()),
    };
    if (fillType === 'gradient') {
      next.gradientDirection = Math.floor(Math.random() * 360);
    }
    if (cssOverlay) {
      next.cssOverlay = { ...cssOverlay };
    }
    updateConfig({ background: next });
  };

  // ── Pattern toggle ────────────────────────────────────────────

  const toggleOverlay = (enable: boolean) => {
    if (enable) {
      if (!cssOverlay) {
        setOverlayPending(true);
        setIsPatternBrowserOpen(true);
      }
    } else {
      setOverlayPending(false);
      updateConfig({
        background: { type: fillType, colors: fillColors },
      });
    }
  };

  // ── PatternCraft browser ──────────────────────────────────────

  const handlePatternCraftSelect = useCallback(
    (pattern: PatternCraftPattern) => {
      const overlay = patternToCssOverlay({
        id: pattern.id,
        style: pattern.style as Record<string, unknown>,
      });
      updateConfig({
        background: {
          type: fillType,
          colors: fillColors,
          cssOverlay: overlay,
        },
      });
    },
    [fillType, fillColors, updateConfig],
  );

  const handleRemovePatternCraft = useCallback(() => {
    updateConfig({
      background: { type: fillType, colors: fillColors },
    });
  }, [fillType, fillColors, updateConfig]);

  let saveLabel = 'Sin cambios pendientes';
  if (saving) {
    saveLabel = 'Guardando...';
  } else if (hasChanges) {
    saveLabel = 'Guardar cambios';
  }

  return (
    <>
      {/* FAB */}
      <button
        className={styles.fab}
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
        aria-label="Personalizar tienda"
      >
        <Icon>settings</Icon>
      </button>

      {/* Backdrop */}
      {open && <div className={styles.backdrop} onClick={handleClose} />}

      {/* Panel */}
      <div ref={panelRef} className={`${styles.panel} ${open ? styles.panelOpen : ''}`}>
        <div className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Personalizar tienda</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Cerrar editor">
            <Icon>close</Icon>
          </button>
        </div>

        <div className={styles.panelBody}>
          {/* ── Toggle modo claro/oscuro ── */}
          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>
              <Icon>contrast</Icon>
              Personaliza para:
            </h3>
            <div className={styles.schemeTabs}>
              {SCHEME_TABS.map((tab) => (
                <button
                  key={tab.value}
                  className={`${styles.schemeTab} ${scheme === tab.value ? styles.schemeTabActive : ''}`}
                  onClick={() => {
                    setScheme(tab.value);
                    onPreviewSchemeChange?.(tab.value);
                  }}
                >
                  {tab.value === 'light' ? <Icon>light_mode</Icon> : <Icon>dark_mode</Icon>}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Paleta de colores ── */}
          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>
              <Icon>palette</Icon>
              Colores
            </h3>
            <div className={styles.colorList}>
              {[
                {
                  key: 'primary' as const,
                  label: 'Principal',
                  hint: 'Botones, enlaces, encabezados',
                },
                {
                  key: 'secondary' as const,
                  label: 'Secundario',
                  hint: 'Etiquetas, badges, bordes',
                },
                { key: 'accent' as const, label: 'Acento', hint: 'Destacados, íconos especiales' },
              ].map(({ key, label, hint }) => {
                const color = getPaletteColor(key);
                return (
                  <div key={key} className={styles.colorRow}>
                    <div className={styles.colorPreviewWrap}>
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => handlePaletteChange(key, e.target.value)}
                        className={styles.colorInput}
                      />
                      <span className={styles.colorPreview} style={{ backgroundColor: color }} />
                    </div>
                    <div className={styles.colorMeta}>
                      <span className={styles.colorLabel}>{label}</span>
                      <span className={styles.colorHint}>{hint}</span>
                      <span className={styles.colorHex}>{color}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Palette preview dots */}
            <div className={styles.palettePreview}>
              {(['primary', 'secondary', 'accent'] as const).map((key) => (
                <span
                  key={key}
                  className={styles.paletteDot}
                  style={{ backgroundColor: currentConfig.palette[key] }}
                />
              ))}
            </div>
          </div>

          {/* ── Tipografía ── */}
          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>
              <Icon>text_fields</Icon>
              Tipografía
            </h3>
            <div className={styles.fontGrid}>
              {FONT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.fontOption} ${storefrontTheme.fontFamily === opt.value ? styles.fontOptionActive : ''}`}
                  onClick={() => updateTheme({ fontFamily: opt.value })}
                >
                  <span
                    className={styles.fontPreview}
                    style={{
                      fontFamily:
                        opt.value === 'google-sans'
                          ? undefined
                          : opt.value === 'inter'
                            ? "'Inter', sans-serif"
                            : "'Roboto', sans-serif",
                    }}
                  >
                    Aa
                  </span>
                  <span className={styles.fontLabel}>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Fondo ── */}
          <div className={styles.sectionCard}>
            <h3 className={styles.sectionTitle}>
              <Icon>wallpaper</Icon>
              Fondo
            </h3>

            <div className={hasActiveOverlay ? styles.fillDisabled : ''}>
              {hasActiveOverlay && (
                <div className={styles.fillDisabledHint}>
                  <Icon>info</Icon>
                  El patrón decorativo tiene prioridad — los colores de relleno no se aplican
                </div>
              )}

              <h4 className={styles.sectionSubtitle}>Relleno</h4>

              {/* ── RELLENO (sólido / degradado) ── */}
              <div className={styles.colorCountRow}>
                <span className={styles.label}>
                  {fillColorCount === 1 ? 'Sólido' : `Degradado (${fillColorCount} colores)`}
                </span>
              </div>

              {/* ── Dirección del degradado ── */}
              {fillColorCount > 1 && (
                <div className={styles.gradientDirRow}>
                  <span className={styles.label}>Dirección</span>
                  <div className={styles.dirControl}>
                    <span className={styles.dirAngle}>{currentDirection}°</span>
                    <button
                      className={styles.dirRandomBtn}
                      onClick={handleRandomizeDirection}
                      title="Randomizar dirección del degradado"
                    >
                      <Icon>shuffle</Icon>
                    </button>
                  </div>
                </div>
              )}

              {/* Color pickers del relleno */}
              <div className={styles.colorList}>
                {fillColors.slice(0, fillColorCount).map((_color, i) => {
                  const color = getFillColor(i);
                  return (
                    <div key={i} className={styles.colorRow}>
                      <div className={styles.colorPreviewWrap}>
                        <input
                          type="color"
                          value={color}
                          onChange={(e) => handleFillColorChange(i, e.target.value)}
                          className={styles.colorInput}
                        />
                        <span className={styles.colorPreview} style={{ backgroundColor: color }} />
                      </div>
                      <div className={styles.colorMeta}>
                        <span className={styles.colorLabel}>
                          {fillColorCount === 1 ? 'Fondo' : `Capa ${i + 1}`}
                        </span>
                        <span className={styles.colorHint}>
                          {i === 0
                            ? 'Color base del fondo'
                            : i === fillColorCount - 1
                              ? 'Tono final del degradado'
                              : 'Transición del degradado'}
                        </span>
                        <span className={styles.colorHex}>{color}</span>
                      </div>
                      {/* Suggested palette chips */}
                      <div className={styles.colorChips}>
                        {THEME_BG_COLORS.slice(0, 4).map((c) => (
                          <button
                            key={c}
                            className={`${styles.colorChip} ${c === color ? styles.colorChipActive : ''}`}
                            style={{ backgroundColor: c }}
                            onClick={() => handleFillColorChange(i, c)}
                            title={c}
                          />
                        ))}
                      </div>
                      {fillColorCount > 1 && (
                        <button
                          className={styles.removeColorBtn}
                          onClick={() => removeColorAt(i)}
                          title="Quitar color"
                        >
                          <Icon>close</Icon>
                        </button>
                      )}
                    </div>
                  );
                })}
                {fillColorCount < 4 && (
                  <button className={styles.addColorBtn} onClick={addColor}>
                    <Icon>add</Icon>
                    Agregar color
                  </button>
                )}
              </div>
            </div>

            <hr className={styles.sectionDivider} />

            <h4 className={styles.sectionSubtitle}>Patrón decorativo</h4>

            {/* ── TOGGLE PATRÓN DECORATIVO ── */}
            <div className={styles.toggleRow}>
              <span className={styles.label}>{hasActiveOverlay ? 'Activado' : 'Desactivado'}</span>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={hasActiveOverlay}
                  onChange={(e) => toggleOverlay(e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            {/* ── CONTROLES DEL PATRÓN ── */}
            {hasActiveOverlay && (
              <>
                {/* Active pattern info */}
                {cssOverlay?.patternId ? (
                  <div className={styles.patternCraftActive}>
                    <div className={styles.patternCraftActiveRow}>
                      <span className={styles.patternCraftActiveIcon}>✦</span>
                      <span>
                        <strong>
                          {getPatternCraftById(cssOverlay.patternId)?.name ?? cssOverlay.patternId}
                        </strong>
                      </span>
                      <button
                        className={styles.patternCraftRemoveBtn}
                        onClick={handleRemovePatternCraft}
                      >
                        Quitar
                      </button>
                    </div>
                    <span className={styles.patternCraftHint}>
                      {hasPatternColor
                        ? 'Patrón con color de fondo propio'
                        : 'Patrón transparente — compatible con relleno de fondo'}
                    </span>
                  </div>
                ) : (
                  <div className={styles.patternCraftActive}>
                    <div className={styles.patternCraftActiveRow}>
                      <span className={styles.patternCraftActiveIcon}>✦</span>
                      <span>Patrón decorativo activo</span>
                    </div>
                  </div>
                )}

                {/* Button to open PatternCraft browser */}
                <div className={styles.colorActions}>
                  <button
                    className={styles.randomBtn}
                    onClick={() => setIsPatternBrowserOpen(true)}
                    style={{ flex: 1 }}
                  >
                    <Icon>auto_awesome</Icon>
                    {cssOverlay?.patternId ? 'Cambiar patrón' : 'Seleccionar patrón'}
                  </button>
                </div>
              </>
            )}

            <hr className={styles.sectionDivider} />

            <h4 className={styles.sectionSubtitle}>Acciones</h4>

            <div className={styles.colorActions}>
              <button
                className={styles.randomBtn}
                onClick={handleRandom}
                disabled={hasPatternColor}
              >
                <Icon>shuffle</Icon>
                Random
              </button>
              <button className={styles.resetBtn} onClick={handleReset}>
                <Icon>restart_alt</Icon>
                Restablecer
              </button>
            </div>
          </div>
        </div>

        {/* Footer del panel */}
        <div className={styles.panelFooter}>
          {feedback && (
            <div className={`${styles.feedback} ${feedback.error ? styles.feedbackError : ''}`}>
              <span>{feedback.message}</span>
              {feedback.error && (
                <button
                  className={styles.feedbackDismiss}
                  type="button"
                  onClick={clearFeedback}
                  aria-label="Cerrar aviso"
                >
                  <Icon>close</Icon>
                </button>
              )}
            </div>
          )}
          <div className={styles.footerActions}>
            <button
              className={styles.discardBtn}
              onClick={discardChanges}
              disabled={saving || !hasChanges}
            >
              Descartar cambios
            </button>
            <button
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>

      {/* ── PatternCraft Browser ── */}
      <PatternBrowser
        open={isPatternBrowserOpen}
        onClose={() => setIsPatternBrowserOpen(false)}
        onSelect={handlePatternCraftSelect}
        currentPatternId={cssOverlay?.patternId}
        colorScheme={scheme}
      />
    </>
  );
}
