import { getPatternCraftById } from './index';
import type { PatternCraftCategory, PatternCraftPattern } from './types';

export type CuratedSchemeSuitability = 'light' | 'dark' | 'both';

export interface CuratedPatternMetadata {
  id: string;
  name: string;
  family: PatternCraftCategory;
  schemeSuitability: CuratedSchemeSuitability;
  supportsMask: boolean;
  supportsBlend: boolean;
}

/**
 * D1 curated catalog: a small, animation-free set with explicit rendering
 * metadata. The full PatternCraft catalog remains available for legacy themes;
 * this list is the source of truth for new storefront pattern selection.
 */
export const curatedPatternCatalog: readonly CuratedPatternMetadata[] = [
  {
    id: 'aurora-edge-glow',
    name: 'Aurora Edge Glow',
    family: 'gradients',
    schemeSuitability: 'dark',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'blue-radial-glow',
    name: 'Blue Radial Glow',
    family: 'gradients',
    schemeSuitability: 'dark',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'center-spotlight-amber',
    name: 'Amber Spotlight',
    family: 'gradients',
    schemeSuitability: 'dark',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'center-spotlight-violet',
    name: 'Violet Spotlight',
    family: 'gradients',
    schemeSuitability: 'dark',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'basic-grid',
    name: 'Basic Grid',
    family: 'geometric',
    schemeSuitability: 'both',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'bottom-fade-grid',
    name: 'Bottom Fade Grid',
    family: 'geometric',
    schemeSuitability: 'light',
    supportsMask: true,
    supportsBlend: false,
  },
  {
    id: 'circuit-board-light',
    name: 'Circuit Board - Light',
    family: 'geometric',
    schemeSuitability: 'light',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'dashed-center-fade-grid',
    name: 'Dashed Center Fade Grid',
    family: 'geometric',
    schemeSuitability: 'both',
    supportsMask: true,
    supportsBlend: false,
  },
  {
    id: 'blue-corner-glow',
    name: 'Blue Corner Glow',
    family: 'decorative',
    schemeSuitability: 'light',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'bottom-emerald-glow',
    name: 'Bottom Emerald Glow',
    family: 'decorative',
    schemeSuitability: 'light',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'azure-depths',
    name: 'Azure Depths',
    family: 'decorative',
    schemeSuitability: 'dark',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'lavender-cosmic-glow',
    name: 'Lavender Cosmic Glow',
    family: 'decorative',
    schemeSuitability: 'both',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'aurora-dream-corner-whispers',
    name: 'Aurora Dream Corner Whispers',
    family: 'effects',
    schemeSuitability: 'light',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'beige-texture',
    name: 'Warm Beige',
    family: 'effects',
    schemeSuitability: 'light',
    supportsMask: false,
    supportsBlend: false,
  },
  {
    id: 'moonlit-fog',
    name: 'Moonlit Fog',
    family: 'effects',
    schemeSuitability: 'both',
    supportsMask: false,
    supportsBlend: true,
  },
  {
    id: 'soft-yellow-glow',
    name: 'Soft Yellow Glow',
    family: 'effects',
    schemeSuitability: 'both',
    supportsMask: false,
    supportsBlend: true,
  },
];

export const curatedPatternIds: readonly string[] = curatedPatternCatalog.map((entry) => entry.id);

const curatedIds = new Set(curatedPatternIds);

/** Resolves only ids in the curated catalog; unknown ids stay undefined. */
export function getCuratedPatternById(id: string): PatternCraftPattern | undefined {
  return curatedIds.has(id) ? getPatternCraftById(id) : undefined;
}
