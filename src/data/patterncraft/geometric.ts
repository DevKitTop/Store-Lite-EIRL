import geometricData from '../../../public/patterns/geometric.json';
import type { PatternCraftPattern } from './types';

/**
 * Full geometric PatternCraft catalog used by server-side canonicalization.
 *
 * The data is imported statically because the storefront theme resolver needs
 * synchronous access to every legacy pattern id. Client-facing selectors use
 * the curated catalog instead, so this data stays off visitor bundles.
 */
export const geometricPatterns: PatternCraftPattern[] = geometricData as PatternCraftPattern[];
