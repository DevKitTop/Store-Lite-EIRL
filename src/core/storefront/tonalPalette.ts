import type { StorefrontColorScheme } from './storefrontTheme';

const LIGHT_TONAL_SURFACE = '#ffffff';
const DARK_TONAL_SURFACE = '#0f1117';
const DEFAULT_TONAL_MIX_RATIO = 0.62;

type Rgb = readonly [number, number, number];

function parseHexColor(color: string): Rgb | undefined {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match) return undefined;

  const value = match[1];
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function formatHexColor(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function mixToward(base: Rgb, target: Rgb, ratio: number): Rgb {
  return [
    base[0] + (target[0] - base[0]) * ratio,
    base[1] + (target[1] - base[1]) * ratio,
    base[2] + (target[2] - base[2]) * ratio,
  ];
}

/**
 * Derives a Material-style container tone by mixing a palette color toward the
 * active scheme surface. The helper is intentionally small and pure so it can
 * run in SSR, hydration, and the editor preview without DOM access.
 */
export function deriveStorefrontTonalContainer(
  color: string,
  scheme: StorefrontColorScheme,
  ratio = DEFAULT_TONAL_MIX_RATIO,
): string {
  const base = parseHexColor(color);
  const surface = parseHexColor(scheme === 'dark' ? DARK_TONAL_SURFACE : LIGHT_TONAL_SURFACE);
  if (!base || !surface) return color;

  const boundedRatio = Math.min(1, Math.max(0, ratio));
  return formatHexColor(mixToward(base, surface, boundedRatio));
}
