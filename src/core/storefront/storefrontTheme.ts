import { sanitizeCssValue, sanitizePatternId } from './cssSafety';

export type StorefrontFontFamily = 'google-sans' | 'inter' | 'roboto' | 'poppins';
export type StorefrontColorScheme = 'light' | 'dark';
export type StorefrontBackgroundType = 'solid' | 'gradient';
export type StorefrontOverlayType =
  | 'dots'
  | 'lines'
  | 'vertical-lines'
  | 'diagonal-lines'
  | 'squares'
  | 'checkerboard'
  | 'crosshatch';

export interface StorefrontPalette {
  primary: string;
  secondary: string;
  accent: string;
}

export interface StorefrontOverlay {
  patternType: StorefrontOverlayType;
  color: string;
  size: number;
}

export interface StorefrontCssOverlay {
  /** PatternCraft pattern ID (or any source ID), for UI selection state */
  patternId?: string;
  /** CSS value for background (base fill color), overrides colors[0] when present */
  background?: string;
  /** CSS value for background-image (required) */
  backgroundImage: string;
  /** CSS value for background-size (optional) */
  backgroundSize?: string;
  /** CSS value for background-position (optional) */
  backgroundPosition?: string;
  /** CSS value for background-repeat (optional) */
  backgroundRepeat?: string;
  /** CSS mask-image / -webkit-mask-image (for fade/dashed effects) */
  maskImage?: string;
  /** CSS mask-size / -webkit-mask-size */
  maskSize?: string;
  /** CSS mask-position / -webkit-mask-position */
  maskPosition?: string;
  /** CSS mask-repeat / -webkit-mask-repeat */
  maskRepeat?: string;
  /** CSS mask-composite / -webkit-mask-composite */
  maskComposite?: string;
  /** CSS background-blend-mode (PatternCraft effects/gradients) */
  backgroundBlendMode?: string;
  /** CSS filter (PatternCraft glow/blur effects) */
  filter?: string;
  /** CSS opacity for the overlay layer */
  opacity?: string;
  /** CSS mix-blend-mode for the overlay layer */
  mixBlendMode?: string;
  /** CSS animation for patterns that define one */
  animation?: string;
  /** CSS box-shadow for inset PatternCraft effects */
  boxShadow?: string;
  /** CSS image-rendering for pixelated geometric patterns */
  imageRendering?: string;
}

export interface StorefrontBackground {
  type: StorefrontBackgroundType;
  colors: string[];
  /** Direction of the gradient fill in degrees (0-360). Default: 135 */
  gradientDirection?: number;
  patternSize?: number; // legacy, kept for backward compat during migration
  overlay?: StorefrontOverlay;
  /** Custom CSS overlay from PatternCraft or any external source.
   *  When present, takes precedence over built-in `overlay`. */
  cssOverlay?: StorefrontCssOverlay;
}

export interface StorefrontColorConfig {
  palette: StorefrontPalette;
  background?: StorefrontBackground;
}

export interface StorefrontTheme {
  version: 2;
  fontFamily: StorefrontFontFamily;
  light: StorefrontColorConfig;
  dark: StorefrontColorConfig;
}

export const STOREFRONT_THEME_PREFERENCES_KEY = 'storefrontTheme';

export const STOREFRONT_FONT_OPTIONS = [
  { value: 'google-sans', label: 'Predeterminado', description: 'Google Sans' },
  { value: 'inter', label: 'Inter', description: 'Inter' },
  { value: 'roboto', label: 'Roboto', description: 'Roboto' },
] as const satisfies readonly {
  value: StorefrontFontFamily;
  label: string;
  description: string;
}[];

export const STOREFRONT_SURFACE_MODE_OPTIONS = [
  { value: 'light', label: 'Modo claro' },
  { value: 'dark', label: 'Modo oscuro' },
] as const satisfies readonly {
  value: StorefrontColorScheme;
  label: string;
}[];

export const STOREFRONT_PRESET_PALETTES: readonly StorefrontPalette[] = [
  { primary: '#6366f1', secondary: '#a855f7', accent: '#ec4899' },
  { primary: '#3b82f6', secondary: '#06b6d4', accent: '#10b981' },
  { primary: '#f59e0b', secondary: '#ef4444', accent: '#f472b6' },
  { primary: '#8b5cf6', secondary: '#6366f1', accent: '#3b82f6' },
  { primary: '#14b8a6', secondary: '#0ea5e9', accent: '#6366f1' },
] as const;

const DEFAULT_LIGHT_PALETTE: StorefrontPalette = {
  primary: '#6366f1',
  secondary: '#a855f7',
  accent: '#ec4899',
};

const DEFAULT_DARK_PALETTE: StorefrontPalette = {
  primary: '#818cf8',
  secondary: '#c084fc',
  accent: '#f472b6',
};

export const DEFAULT_STOREFRONT_THEME: StorefrontTheme = {
  version: 2,
  fontFamily: 'google-sans',
  light: { palette: { ...DEFAULT_LIGHT_PALETTE } },
  dark: { palette: { ...DEFAULT_DARK_PALETTE } },
};

/**
 * Returns the color config for a given scheme (light or dark).
 */
export function getStorefrontColorConfig(
  theme: StorefrontTheme,
  scheme: StorefrontColorScheme,
): StorefrontColorConfig {
  return scheme === 'dark' ? theme.dark : theme.light;
}

export function normalizeStorefrontColorScheme(input: unknown): StorefrontColorScheme {
  return input === 'dark' ? 'dark' : 'light';
}

/** Strict guard for values arriving from the client (no silent fallback). */
export function isStorefrontColorScheme(input: unknown): input is StorefrontColorScheme {
  return input === 'light' || input === 'dark';
}

// ─── Pattern CSS helpers ──────────────────────────────────────────

/**
 * Returns one or more CSS background-image values for a given pattern.
 *
 * Patterns are built as transparent-background layers so the fill color or
 * gradient underneath shows through. The caller layers them on top of the
 * fill via multiple backgrounds (pattern first = topmost in CSS).
 *
 * ─ Strategies used:
 * - Tile-based (non-repeating): dots, squares, checkerboard
 *   A single tile is defined with gradients, and background-size + repeat
 *   handle the tiling.
 * - Axis-aligned repeating: lines, vertical-lines
 *   repeating-linear-gradient runs along the axis, background-size limits
 *   the tile to one period along that axis.
 * - Free repeating: diagonal-lines, crosshatch
 *   repeating-linear-gradient handles all tiling; background-size = auto
 *   so the gradient fills the element naturally.
 */
function buildPatternImage(type: StorefrontOverlayType, color: string, size: number): string {
  switch (type) {
    case 'dots':
      return `radial-gradient(circle, ${color} 1px, transparent 1px)`;
    case 'lines':
      return `repeating-linear-gradient(0deg, ${color}, ${color} 1px, transparent 1px, transparent ${size}px)`;
    case 'vertical-lines':
      return `repeating-linear-gradient(90deg, ${color}, ${color} 1px, transparent 1px, transparent ${size}px)`;
    case 'diagonal-lines':
      return `repeating-linear-gradient(45deg, ${color}, ${color} 1px, transparent 1px, transparent ${size}px)`;
    case 'squares':
      return [
        `linear-gradient(0deg, ${color}, ${color} 1px, transparent 1px, transparent ${size}px)`,
        `linear-gradient(90deg, ${color}, ${color} 1px, transparent 1px, transparent ${size}px)`,
      ].join(', ');
    case 'checkerboard': {
      // Standard 2-gradient checkerboard: each gradient draws the full pattern,
      // the second is offset by half the tile to fill in the gaps.
      // Tile size = 2*size × 2*size, with squares of size × size.
      const grad = `linear-gradient(45deg, ${color} 25%, transparent 25%, transparent 75%, ${color} 75%)`;
      return `${grad}, ${grad}`;
    }
    case 'crosshatch':
      return [
        `repeating-linear-gradient(45deg, transparent, transparent ${size}px, ${color} ${size}px, ${color} ${size + 1}px)`,
        `repeating-linear-gradient(-45deg, transparent, transparent ${size}px, ${color} ${size}px, ${color} ${size + 1}px)`,
      ].join(', ');
  }
}

/**
 * Returns the background-size for a pattern layer.
 *
 * - Tile-based patterns (dots, squares, checkerboard): size = tile dimensions.
 * - Axis-aligned repeating (lines, vertical-lines): size = one period along
 *   the axis, `auto` on the other so the gradient fills naturally.
 * - Free repeating (diagonal-lines, crosshatch): `auto` — let the native
 *   repeating-linear-gradient handle tiling at its own period.
 */
function patternSizeCSS(type: StorefrontOverlayType, size: number): string {
  switch (type) {
    case 'dots':
      return `${size}px ${size}px`;
    case 'lines':
      return `auto ${size}px`;
    case 'vertical-lines':
      return `${size}px auto`;
    case 'diagonal-lines':
      return 'auto';
    case 'squares':
      return `${size}px ${size}px`;
    case 'checkerboard':
      return `${size * 2}px ${size * 2}px`;
    case 'crosshatch':
      return 'auto';
  }
}

/**
 * Returns the background-position for a pattern layer.
 * Most patterns use a single position (0 0). Checkerboard needs 2 positions
 * because the 2-gradient approach offsets the second copy by half the tile.
 */
function patternPositionCSS(type: StorefrontOverlayType, size: number): string {
  if (type === 'checkerboard') {
    return `0 0, ${size}px ${size}px`;
  }
  return '0 0';
}

/**
 * How many CSS background-image values a pattern expands to.
 * Used to correctly size background-size / background-position lists
 * when the pattern is combined with the gradient fill.
 */
function patternImageCount(type: StorefrontOverlayType): number {
  switch (type) {
    case 'dots':
    case 'lines':
    case 'vertical-lines':
    case 'diagonal-lines':
      return 1;
    case 'squares':
    case 'checkerboard':
    case 'crosshatch':
      return 2;
  }
}

// ─── Public builder ──────────────────────────────────────────────

/** Returns the CSS angle string for a background's gradient direction. */
function gradientAngle(bg: StorefrontBackground): string {
  const deg = bg.gradientDirection ?? 135;
  return `${deg}deg`;
}

export function buildBackgroundCSS(bg?: StorefrontBackground): Record<string, string> {
  if (!bg || !bg.colors.length) return {};

  const vars: Record<string, string> = {};
  const baseColor = bg.colors[0];

  // ── Custom CSS overlay (from PatternCraft etc.) is the ENTIRE background ──
  // When present, fill colors and gradient direction are IGNORED.
  // The overlay "exists" if it has a non-empty backgroundImage or background color.
  const hasCssOverlay =
    bg.cssOverlay &&
    ((typeof bg.cssOverlay.backgroundImage === 'string' &&
      bg.cssOverlay.backgroundImage.length > 0) ||
      (typeof bg.cssOverlay.background === 'string' && bg.cssOverlay.background.length > 0));

  if (hasCssOverlay) {
    // ── Background color ──
    // When a PatternCraft overlay is active, fill colors are IGNORED completely.
    // The background comes from the pattern's own color (if it has one),
    // or falls back to the base fill color so transparent overlay patterns
    // (grids, dots) render on a visible background instead of transparent.
    vars['--storefront-bg'] = bg.cssOverlay!.background ?? baseColor;

    // ── Background image ──
    if (bg.cssOverlay!.backgroundImage.length > 0) {
      vars['--storefront-bg-image'] = bg.cssOverlay!.backgroundImage;
      if (bg.cssOverlay!.backgroundSize) {
        vars['--storefront-bg-size'] = bg.cssOverlay!.backgroundSize;
      }
      if (bg.cssOverlay!.backgroundPosition) {
        vars['--storefront-bg-position'] = bg.cssOverlay!.backgroundPosition;
      }
    }

    // ── Background repeat ──
    if (bg.cssOverlay!.backgroundRepeat) {
      vars['--storefront-bg-repeat'] = bg.cssOverlay!.backgroundRepeat;
    }

    // ── Mask (fade/dashed effects) ──
    if (bg.cssOverlay!.maskImage) {
      vars['--storefront-mask-image'] = bg.cssOverlay!.maskImage;
    }
    if (bg.cssOverlay!.maskSize) {
      vars['--storefront-mask-size'] = bg.cssOverlay!.maskSize;
    }
    if (bg.cssOverlay!.maskPosition) {
      vars['--storefront-mask-position'] = bg.cssOverlay!.maskPosition;
    }
    if (bg.cssOverlay!.maskRepeat) {
      vars['--storefront-mask-repeat'] = bg.cssOverlay!.maskRepeat;
    }
    if (bg.cssOverlay!.maskComposite) {
      vars['--storefront-mask-composite'] = bg.cssOverlay!.maskComposite;
    }
    if (bg.cssOverlay!.backgroundBlendMode) {
      vars['--storefront-bg-blend-mode'] = bg.cssOverlay!.backgroundBlendMode;
    }
    if (bg.cssOverlay!.filter) {
      vars['--storefront-filter'] = bg.cssOverlay!.filter;
    }
    if (bg.cssOverlay!.opacity) {
      vars['--storefront-opacity'] = bg.cssOverlay!.opacity;
    }
    if (bg.cssOverlay!.mixBlendMode) {
      vars['--storefront-mix-blend-mode'] = bg.cssOverlay!.mixBlendMode;
    }
    if (bg.cssOverlay!.animation) {
      vars['--storefront-animation'] = bg.cssOverlay!.animation;
    }
    if (bg.cssOverlay!.boxShadow) {
      vars['--storefront-box-shadow'] = bg.cssOverlay!.boxShadow;
    }
    if (bg.cssOverlay!.imageRendering) {
      vars['--storefront-image-rendering'] = bg.cssOverlay!.imageRendering;
    }
  } else {
    // ── Built-in overlay ──
    const hasOverlay = bg.overlay && OVERLAY_TYPES.includes(bg.overlay.patternType);

    if (hasOverlay) {
      const o = bg.overlay!;
      const patternImg = buildPatternImage(o.patternType, o.color, o.size);
      const pSize = patternSizeCSS(o.patternType, o.size);
      const pPos = patternPositionCSS(o.patternType, o.size);
      const pCount = patternImageCount(o.patternType);

      // Expand size/position values to cover all pattern images.
      const sizes = Array(pCount).fill(pSize).join(', ');
      // position may already be multi-value (checkerboard) or single (others)
      const isPosMulti = pPos.includes(', ');
      const positions = isPosMulti ? pPos : Array(pCount).fill(pPos).join(', ');

      if (bg.type === 'gradient' && bg.colors.length >= 2) {
        const gradientImg = `linear-gradient(${gradientAngle(bg)}, ${bg.colors.slice(0, 4).join(', ')})`;
        vars['--storefront-bg-image'] = `${patternImg}, ${gradientImg}`;
        vars['--storefront-bg-size'] = `${sizes}, cover`;
        vars['--storefront-bg-position'] = `${positions}, 0 0`;
      } else {
        vars['--storefront-bg-image'] = patternImg;
        vars['--storefront-bg-size'] = sizes;
        vars['--storefront-bg-position'] = positions;
      }
    } else if (bg.type === 'gradient' && bg.colors.length >= 2) {
      const colors = bg.colors.slice(0, 4);
      vars['--storefront-bg-image'] = `linear-gradient(${gradientAngle(bg)}, ${colors.join(', ')})`;
    }
    // Solid without overlay → just the background color, no image needed
  }

  // Asegurar que --storefront-bg tenga un valor para que el layout
  // herede el color base del storefront en vez de md-sys-color-surface.
  if (!vars['--storefront-bg']) {
    vars['--storefront-bg'] = baseColor;
  }

  return vars;
}

// ─── Internal helpers ──────────────────────────────────────────────

const FONT_OPTIONS: readonly StorefrontFontFamily[] = ['google-sans', 'inter', 'roboto', 'poppins'];

const FILL_TYPES: readonly StorefrontBackgroundType[] = ['solid', 'gradient'];
const OVERLAY_TYPES: readonly StorefrontOverlayType[] = [
  'dots',
  'lines',
  'vertical-lines',
  'diagonal-lines',
  'squares',
  'checkerboard',
  'crosshatch',
];
// Used for validating incoming data (includes both new and legacy pattern-as-type format)
const BACKGROUND_TYPES: readonly string[] = [...FILL_TYPES, ...OVERLAY_TYPES];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function randomHexColor() {
  return (
    '#' +
    Math.floor(Math.random() * 16777215)
      .toString(16)
      .padStart(6, '0')
  );
}

function isFontFamily(value: unknown): value is StorefrontFontFamily {
  return typeof value === 'string' && FONT_OPTIONS.includes(value as StorefrontFontFamily);
}

function isOverlayType(value: unknown): value is StorefrontOverlayType {
  return typeof value === 'string' && OVERLAY_TYPES.includes(value as StorefrontOverlayType);
}

function normalizeStorefrontBackground(input: unknown): StorefrontBackground | undefined {
  if (!isRecord(input)) return undefined;

  const rawType = input.type as string;
  if (!BACKGROUND_TYPES.includes(rawType)) return undefined;

  const colors = Array.isArray(input.colors)
    ? (input.colors as unknown[]).filter((c): c is string => isHexColor(c as string))
    : [];

  // ── Legacy migration: pattern stored directly as type → convert to fill + overlay ──
  if (isOverlayType(rawType)) {
    if (colors.length < 2) return undefined;
    return {
      type: 'solid',
      colors: [colors[0]],
      overlay: {
        patternType: rawType,
        color: colors[1],
        size:
          typeof input.patternSize === 'number' ? Math.max(4, Math.min(60, input.patternSize)) : 16,
      },
    };
  }

  // ── New format: fill (solid/gradient) + optional overlay ──
  const type = rawType as StorefrontBackgroundType;
  const minColors = type === 'solid' ? 1 : 2;
  if (colors.length < minColors) return undefined;

  // Normalize built-in overlay if present
  const overlayInput = isRecord(input.overlay)
    ? (input.overlay as Record<string, unknown>)
    : undefined;
  let overlay: StorefrontOverlay | undefined;
  if (overlayInput && isOverlayType(overlayInput.patternType)) {
    overlay = {
      patternType: overlayInput.patternType,
      color: isHexColor(overlayInput.color)
        ? overlayInput.color
        : colors[0] !== '#ffffff'
          ? '#ffffff'
          : '#111827',
      size:
        typeof overlayInput.size === 'number' ? Math.max(4, Math.min(60, overlayInput.size)) : 16,
    };
  }

  // Normalize custom CSS overlay (from PatternCraft or similar).
  // Every field is client input that is persisted and later serialized into a
  // <style> tag served to buyers, so each value goes through the sanitizer and
  // an unsafe value is dropped instead of stored.
  const cssInput = isRecord(input.cssOverlay)
    ? (input.cssOverlay as Record<string, unknown>)
    : undefined;
  let cssOverlay: StorefrontCssOverlay | undefined;
  if (cssInput) {
    const backgroundImage = sanitizeCssValue(cssInput.backgroundImage);
    if (backgroundImage) {
      cssOverlay = {
        patternId: sanitizePatternId(cssInput.patternId),
        background: sanitizeCssValue(cssInput.background),
        backgroundImage,
        backgroundSize: sanitizeCssValue(cssInput.backgroundSize),
        backgroundPosition: sanitizeCssValue(cssInput.backgroundPosition),
        backgroundRepeat: sanitizeCssValue(cssInput.backgroundRepeat),
        maskImage: sanitizeCssValue(cssInput.maskImage),
        maskSize: sanitizeCssValue(cssInput.maskSize),
        maskPosition: sanitizeCssValue(cssInput.maskPosition),
        maskRepeat: sanitizeCssValue(cssInput.maskRepeat),
        maskComposite: sanitizeCssValue(cssInput.maskComposite),
        backgroundBlendMode: sanitizeCssValue(cssInput.backgroundBlendMode),
        filter: sanitizeCssValue(cssInput.filter),
        opacity: sanitizeCssValue(
          typeof cssInput.opacity === 'number' ? String(cssInput.opacity) : cssInput.opacity,
        ),
        mixBlendMode: sanitizeCssValue(cssInput.mixBlendMode),
        animation: sanitizeCssValue(cssInput.animation),
        boxShadow: sanitizeCssValue(cssInput.boxShadow),
        imageRendering: sanitizeCssValue(cssInput.imageRendering),
      };
    }
  }

  // Normalize gradient direction (0-360, default 135)
  let gradientDirection: number | undefined;
  if (type === 'gradient' && typeof input.gradientDirection === 'number') {
    gradientDirection = ((input.gradientDirection % 360) + 360) % 360;
  }

  return {
    type,
    colors: colors.slice(0, 4),
    ...(gradientDirection !== undefined ? { gradientDirection } : {}),
    ...(overlay ? { overlay } : {}),
    ...(cssOverlay ? { cssOverlay } : {}),
  };
}

function normalizeColorConfig(
  input: unknown,
  fallback: StorefrontColorConfig,
): StorefrontColorConfig {
  if (!isRecord(input)) {
    return { palette: { ...fallback.palette } };
  }

  const palette = isRecord(input.palette) ? input.palette : {};
  return {
    palette: {
      primary: isHexColor(palette.primary) ? palette.primary : fallback.palette.primary,
      secondary: isHexColor(palette.secondary) ? palette.secondary : fallback.palette.secondary,
      accent: isHexColor(palette.accent) ? palette.accent : fallback.palette.accent,
    },
    background: normalizeStorefrontBackground(input.background),
  };
}

// ─── Public helpers ────────────────────────────────────────────────

/**
 * Convierte un canal sRGB gamma-compressed a un valor lineal.
 * Usa la fórmula WCAG 2.1 (decodificación gamma sRGB).
 */
function linearizeChannel(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Calcula la luminancia relativa WCAG 2.1 de un color hex (#rrggbb).
 * Retorna un valor entre 0 (negro) y 1 (blanco).
 */
export function getStorefrontColorLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
}

/**
 * Calcula el WCAG 2.1 contrast ratio entre dos colores hex.
 * Retorna un valor entre 1:1 (mismo color) y 21:1 (negro vs blanco).
 * WCAG AA requiere 4.5:1 para texto normal, 3:1 para texto grande.
 */
export function getContrastRatio(hexA: string, hexB: string): number {
  const l1 = getStorefrontColorLuminance(hexA);
  const l2 = getStorefrontColorLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Retorna el color de texto más legible sobre el fondo dado,
 * usando WCAG 2.1 contrast ratio. Por defecto busca AA (4.5:1),
 * y si ningún color lo alcanza, elige el que mejor ratio da.
 *
 * @param background - Color de fondo en hex (#rrggbb)
 * @param dark - Color oscuro para texto (default: #111827)
 * @param light - Color claro para texto (default: #ffffff)
 * @param minRatio - Ratio mínimo WCAG (default 4.5 para AA)
 */
export function getReadableTextColor(
  background: string,
  dark = '#111827',
  light = '#ffffff',
  minRatio = 4.5,
): string {
  const darkRatio = getContrastRatio(background, dark);
  const lightRatio = getContrastRatio(background, light);

  // Si ambos pasan, elegir el de MEJOR contraste
  if (darkRatio >= minRatio && lightRatio >= minRatio) {
    return darkRatio >= lightRatio ? dark : light;
  }

  // Si solo uno pasa AA, usarlo
  if (darkRatio >= minRatio) return dark;
  if (lightRatio >= minRatio) return light;

  // Si ninguno pasa AA, elegir el mejor disponible
  return darkRatio >= lightRatio ? dark : light;
}

export function createRandomStorefrontPalette(): StorefrontPalette {
  return {
    primary: randomHexColor(),
    secondary: randomHexColor(),
    accent: randomHexColor(),
  };
}

export function createDefaultStorefrontTheme(): StorefrontTheme {
  return {
    version: 2,
    fontFamily: DEFAULT_STOREFRONT_THEME.fontFamily,
    light: { palette: { ...DEFAULT_LIGHT_PALETTE } },
    dark: { palette: { ...DEFAULT_DARK_PALETTE } },
  };
}

export function createRandomStorefrontTheme(
  overrides: Partial<Pick<StorefrontTheme, 'fontFamily'>> = {},
): StorefrontTheme {
  return normalizeStorefrontTheme({
    version: 2,
    fontFamily: overrides.fontFamily ?? DEFAULT_STOREFRONT_THEME.fontFamily,
    light: { palette: createRandomStorefrontPalette() },
    dark: { palette: createRandomStorefrontPalette() },
  });
}

export function createStorefrontThemeFromPalette(
  palette: StorefrontPalette,
  overrides: Partial<Pick<StorefrontTheme, 'fontFamily'>> = {},
): StorefrontTheme {
  return normalizeStorefrontTheme({
    version: 2,
    fontFamily: overrides.fontFamily ?? DEFAULT_STOREFRONT_THEME.fontFamily,
    light: { palette },
    dark: { palette },
  });
}

export function normalizeStorefrontTheme(input: unknown): StorefrontTheme {
  const fallback = createDefaultStorefrontTheme();
  if (!isRecord(input)) return fallback;

  // ── v1 migration: convert single palette+background to v2 ──
  if (input.version !== 2) {
    const palette = isRecord(input.palette) ? input.palette : {};
    const normalizedPalette: StorefrontPalette = {
      primary: isHexColor(palette.primary) ? palette.primary : fallback.light.palette.primary,
      secondary: isHexColor(palette.secondary)
        ? palette.secondary
        : fallback.light.palette.secondary,
      accent: isHexColor(palette.accent) ? palette.accent : fallback.light.palette.accent,
    };
    const bg = normalizeStorefrontBackground(input.background);

    return {
      version: 2,
      fontFamily: isFontFamily(input.fontFamily) ? input.fontFamily : fallback.fontFamily,
      light: { palette: { ...normalizedPalette }, background: bg },
      dark: { palette: { ...normalizedPalette }, background: bg },
    };
  }

  // ── v2 normalization ──
  return {
    version: 2,
    fontFamily: isFontFamily(input.fontFamily) ? input.fontFamily : fallback.fontFamily,
    light: normalizeColorConfig(input.light, fallback.light),
    dark: normalizeColorConfig(input.dark, fallback.dark),
  };
}

export function getStorefrontThemeFromPreferences(preferences: unknown): StorefrontTheme {
  if (!isRecord(preferences)) {
    return createDefaultStorefrontTheme();
  }

  return normalizeStorefrontTheme(preferences[STOREFRONT_THEME_PREFERENCES_KEY]);
}

export function mergeStorefrontThemeIntoPreferences(
  preferences: unknown,
  storefrontTheme: StorefrontTheme,
): Record<string, unknown> {
  const basePreferences = isRecord(preferences) ? { ...preferences } : {};

  return {
    ...basePreferences,
    [STOREFRONT_THEME_PREFERENCES_KEY]: normalizeStorefrontTheme(storefrontTheme),
  };
}

/**
 * Returns true if a custom storefront theme has been explicitly saved in preferences.
 * When false, the storefront should inherit the platform's MD3 design system colors.
 */
export function hasCustomStorefrontTheme(preferences: unknown): boolean {
  if (!isRecord(preferences)) return false;
  return preferences[STOREFRONT_THEME_PREFERENCES_KEY] !== undefined;
}

/**
 * Removes the storefrontTheme key from preferences, effectively resetting
 * the storefront to the platform's default MD3 color tokens.
 */
export function clearStorefrontThemeFromPreferences(preferences: unknown): Record<string, unknown> {
  const basePreferences = isRecord(preferences) ? { ...preferences } : {};
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [STOREFRONT_THEME_PREFERENCES_KEY]: _, ...rest } = basePreferences;
  return rest;
}

/**
 * Converts a PatternCraft pattern's style into a StorefrontCssOverlay.
 *
 * Handles three pattern style conventions:
 * 1. `background: "#color"` + `backgroundImage: "gradient(...)"` — color + image
 * 2. `background: "gradient(...)"` — gradient as shorthand (extracted to backgroundImage)
 * 3. `backgroundColor: "#color"` + `backgroundImage: "gradient(...)"` — React-style color + image
 *
 * Mask-related CSS properties (`maskImage`, `WebkitMaskImage`, `maskComposite`) are
 * now extracted so fade/dashed geometric patterns render correctly on the storefront.
 */
export function patternToCssOverlay(pattern: {
  id: string;
  style: Record<string, unknown>;
}): StorefrontCssOverlay {
  const rawBgImage =
    typeof pattern.style.backgroundImage === 'string' ? pattern.style.backgroundImage.trim() : '';
  const rawBg = typeof pattern.style.background === 'string' ? pattern.style.background.trim() : '';
  const rawBgColor =
    typeof pattern.style.backgroundColor === 'string' ? pattern.style.backgroundColor.trim() : '';

  let bgColor: string | undefined;
  let bgImage = rawBgImage;

  // 1. Check `backgroundColor` field (React-style, 3 patterns use this)
  if (rawBgColor && looksLikeColor(rawBgColor)) {
    bgColor = rawBgColor;
  }

  // 2. Check `background` field — could be color or gradient shorthand
  if (rawBg) {
    let processedRawBg = rawBg;

    // Check if there is a trailing solid color (e.g. "...gradient(...), #000000")
    const lastCommaIndex = processedRawBg.lastIndexOf(',');
    if (lastCommaIndex !== -1) {
      const possibleColor = processedRawBg.slice(lastCommaIndex + 1).trim();
      // If the trailing part is a valid color and not a gradient piece
      if (
        /^#[0-9a-fA-F]{3,8}$/.test(possibleColor) ||
        /^(black|white|transparent)$/i.test(possibleColor)
      ) {
        bgColor = possibleColor;
        processedRawBg = processedRawBg.slice(0, lastCommaIndex).trim();
      }
    }

    if (processedRawBg) {
      if (looksLikeGradientOrImage(processedRawBg)) {
        // Gradient shorthand → prepend to backgroundImage
        bgImage = bgImage ? `${processedRawBg}, ${bgImage}` : processedRawBg;
      } else if (looksLikeColor(processedRawBg)) {
        // Plain color → use as background color
        if (!bgColor) bgColor = processedRawBg;
      } else {
        // Fallback
        if (!bgColor) bgColor = processedRawBg;
      }
    }
  }

  const overlay: StorefrontCssOverlay = {
    patternId: pattern.id,
    background: bgColor,
    backgroundImage: bgImage,
  };

  if (
    typeof pattern.style.backgroundSize === 'string' &&
    pattern.style.backgroundSize.trim().length > 0
  ) {
    overlay.backgroundSize = pattern.style.backgroundSize.trim();
  }

  if (
    typeof pattern.style.backgroundPosition === 'string' &&
    pattern.style.backgroundPosition.trim().length > 0
  ) {
    overlay.backgroundPosition = pattern.style.backgroundPosition.trim();
  }

  // Pass through the background-repeat if the pattern specifies it
  if (
    typeof pattern.style.backgroundRepeat === 'string' &&
    pattern.style.backgroundRepeat.trim().length > 0
  ) {
    overlay.backgroundRepeat = pattern.style.backgroundRepeat.trim();
  }

  // ── Mask properties (fade/dashed effects) ──
  // Prefer maskImage, fall back to WebkitMaskImage
  const maskImg =
    typeof pattern.style.maskImage === 'string'
      ? pattern.style.maskImage.trim()
      : typeof pattern.style.WebkitMaskImage === 'string'
        ? pattern.style.WebkitMaskImage.trim()
        : '';
  if (maskImg.length > 0) {
    overlay.maskImage = maskImg;
  }

  const maskSize =
    typeof pattern.style.maskSize === 'string'
      ? pattern.style.maskSize.trim()
      : typeof pattern.style.WebkitMaskSize === 'string'
        ? pattern.style.WebkitMaskSize.trim()
        : '';
  if (maskSize.length > 0) {
    overlay.maskSize = maskSize;
  }

  const maskPosition =
    typeof pattern.style.maskPosition === 'string'
      ? pattern.style.maskPosition.trim()
      : typeof pattern.style.WebkitMaskPosition === 'string'
        ? pattern.style.WebkitMaskPosition.trim()
        : '';
  if (maskPosition.length > 0) {
    overlay.maskPosition = maskPosition;
  }

  const maskRepeat =
    typeof pattern.style.maskRepeat === 'string'
      ? pattern.style.maskRepeat.trim()
      : typeof pattern.style.WebkitMaskRepeat === 'string'
        ? pattern.style.WebkitMaskRepeat.trim()
        : '';
  if (maskRepeat.length > 0) {
    overlay.maskRepeat = maskRepeat;
  }

  // Prefer maskComposite, fall back to WebkitMaskComposite
  const maskComp =
    typeof pattern.style.maskComposite === 'string'
      ? pattern.style.maskComposite.trim()
      : typeof pattern.style.WebkitMaskComposite === 'string'
        ? pattern.style.WebkitMaskComposite.trim()
        : '';
  if (maskComp.length > 0) {
    overlay.maskComposite = maskComp;
  }

  const passthroughStringProps = [
    'backgroundBlendMode',
    'filter',
    'mixBlendMode',
    'animation',
    'boxShadow',
    'imageRendering',
  ] as const;

  for (const prop of passthroughStringProps) {
    const value = pattern.style[prop];
    if (typeof value === 'string' && value.trim().length > 0) {
      overlay[prop] = value.trim();
    }
  }

  const opacity = pattern.style.opacity;
  if (typeof opacity === 'number') {
    overlay.opacity = String(opacity);
  } else if (typeof opacity === 'string' && opacity.trim().length > 0) {
    overlay.opacity = opacity.trim();
  }

  return overlay;
}

/** Check if a CSS value is a plain color (hex, rgb/a, hsl/a, hwb, or common named). */
function looksLikeColor(value: string): boolean {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return true;
  if (/^rgba?\(/i.test(v)) return true;
  if (/^hsla?\(/i.test(v)) return true;
  if (/^hwb\(/i.test(v)) return true;
  if (
    /^(black|white|red|blue|green|yellow|purple|pink|orange|brown|gray|grey|transparent|currentColor)$/i.test(
      v,
    )
  )
    return true;
  return false;
}

/** Check if a CSS value is a gradient or URL image (not safe for background-color). */
function looksLikeGradientOrImage(value: string): boolean {
  const v = value.trim();
  return (
    v.startsWith('linear-gradient(') ||
    v.startsWith('radial-gradient(') ||
    v.startsWith('conic-gradient(') ||
    v.startsWith('repeating-linear-gradient(') ||
    v.startsWith('repeating-radial-gradient(') ||
    v.startsWith('url(') ||
    v.startsWith('image-set(') ||
    v.startsWith('image(')
  );
}
