import curatedPatternData from './curated-patterns.json';
import type { PatternCraftCategory, PatternCraftPattern, PatternCraftStyle } from './types';

export type { PatternCraftCategory, PatternCraftPattern, PatternCraftStyle } from './types';

export type CuratedSchemeSuitability = 'light' | 'dark' | 'both';

export interface CuratedPatternMetadata {
  id: string;
  name: string;
  family: PatternCraftCategory;
  schemeSuitability: CuratedSchemeSuitability;
  supportsMask: boolean;
  supportsBlend: boolean;
}

const LEGACY_SCHEME_OVERRIDES: Readonly<Record<string, CuratedSchemeSuitability>> = {
  'aurora-edge-glow': 'dark',
  'blue-radial-glow': 'dark',
  'center-spotlight-amber': 'dark',
  'center-spotlight-violet': 'dark',
  'basic-grid': 'both',
  'bottom-fade-grid': 'light',
  'circuit-board-light': 'light',
  'dashed-center-fade-grid': 'both',
  'blue-corner-glow': 'light',
  'bottom-emerald-glow': 'light',
  'azure-depths': 'dark',
  'lavender-cosmic-glow': 'both',
  'aurora-dream-corner-whispers': 'light',
  'beige-texture': 'light',
  'moonlit-fog': 'both',
  'soft-yellow-glow': 'both',
};

function luminanceFromHex(hex: string): number | undefined {
  const normalized =
    hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex.slice(0, 7);
  const match = normalized.match(/^#([0-9a-f]{6})$/i);
  if (!match) return undefined;
  const r = parseInt(match[1].slice(0, 2), 16);
  const g = parseInt(match[1].slice(2, 4), 16);
  const b = parseInt(match[1].slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function extractColorLuminances(value: string): number[] {
  const luminances: number[] = [];
  const hexMatches = value.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  for (const hex of hexMatches) {
    const lum = luminanceFromHex(hex);
    if (lum !== undefined) luminances.push(lum);
  }
  return luminances;
}

/**
 * Classifies a pattern by scheme compatibility.
 * - 'dark': dark own background -> show only in dark mode
 * - 'light': light own background -> show only in light mode
 * - 'both': transparent overlay -> show in both modes
 */
export function classifyPatternSuitability(style: PatternCraftStyle): CuratedSchemeSuitability {
  const bg = (typeof style.background === 'string' ? style.background : '').trim();
  const bgColor = (typeof style.backgroundColor === 'string' ? style.backgroundColor : '').trim();
  const bgImage = (typeof style.backgroundImage === 'string' ? style.backgroundImage : '').trim();
  let color = bgColor;

  if (!bgColor && bg) {
    const lastComma = bg.lastIndexOf(',');
    if (lastComma !== -1) {
      const possibleColor = bg.slice(lastComma + 1).trim();
      if (/^#[0-9a-fA-F]{6,8}$/.test(possibleColor)) {
        color = possibleColor;
      }
    }
    if (!color && !/gradient\(|url\(|image\(/i.test(bg)) {
      color = bg;
    }
  }

  const source = [bgColor, bg, bgImage].filter(Boolean).join(' ');
  const luminances = extractColorLuminances(source);
  if (!color && luminances.length > 0 && /gradient\(|url\(|image\(/i.test(source)) {
    const average = luminances.reduce((sum, lum) => sum + lum, 0) / luminances.length;
    return average < 0.45 ? 'dark' : 'light';
  }

  if (!color) return 'both';

  if (/^#0[0-9a-f]{5}$/i.test(color)) return 'dark';
  if (/^#1[0-9a-f]{5}$/i.test(color)) return 'dark';
  if (/^#2[0-9a-b][0-9a-f]{4}$/i.test(color)) return 'dark';
  if (color === '#000' || color === '#000000' || color === 'black') return 'dark';

  const lum = luminanceFromHex(color);
  if (lum !== undefined) {
    return lum < 0.4 ? 'dark' : 'light';
  }

  return 'light';
}

function isRenderablePattern(pattern: PatternCraftPattern): boolean {
  const serialized = JSON.stringify(pattern.style);
  return !/animation/i.test(serialized) && !/url\(/i.test(serialized);
}

const curatedPatterns = (curatedPatternData as unknown as PatternCraftPattern[]).filter(
  isRenderablePattern,
);

/**
 * Render-safe storefront catalog: every PatternCraft pattern whose style uses
 * neither `animation` nor `url()`. Those two cases cannot render identically in
 * the selector preview and on the published storefront, so legacy themes keep
 * them through `getPatternCraftById` while new selection stays consistent.
 */
export const curatedPatternCatalog: readonly CuratedPatternMetadata[] = curatedPatterns.map(
  (pattern) => ({
    id: pattern.id,
    name: pattern.name,
    family: pattern.category,
    schemeSuitability:
      LEGACY_SCHEME_OVERRIDES[pattern.id] ?? classifyPatternSuitability(pattern.style),
    supportsMask: pattern.hasMask,
    supportsBlend: Boolean(pattern.style.backgroundBlendMode || pattern.style.mixBlendMode),
  }),
);

export const curatedPatternIds: readonly string[] = curatedPatternCatalog.map((entry) => entry.id);

const curatedIds = new Set(curatedPatternIds);
const curatedPatternsById = new Map(curatedPatterns.map((pattern) => [pattern.id, pattern]));

/** Render-safe patterns grouped by family for the storefront selector. */
export const curatedPatternByCategory: Record<PatternCraftCategory, PatternCraftPattern[]> = {
  gradients: curatedPatterns.filter((pattern) => pattern.category === 'gradients'),
  geometric: curatedPatterns.filter((pattern) => pattern.category === 'geometric'),
  decorative: curatedPatterns.filter((pattern) => pattern.category === 'decorative'),
  effects: curatedPatterns.filter((pattern) => pattern.category === 'effects'),
};

/** Resolves only ids in the curated catalog; unknown ids stay undefined. */
export function getCuratedPatternById(id: string): PatternCraftPattern | undefined {
  return curatedIds.has(id) ? curatedPatternsById.get(id) : undefined;
}
