import { describe, expect, it, vi } from 'vitest';

vi.mock('@/data/patterncraft', () => {
  throw new Error('Curated client catalog must not import the full PatternCraft catalog');
});

describe('T32 curated catalog bundle boundary', () => {
  it('resolves curated patterns without loading the full catalog', async () => {
    const { curatedPatternByCategory, getCuratedPatternById } =
      await import('@/data/patterncraft/curated');

    const basicGrid = getCuratedPatternById('basic-grid');

    expect(basicGrid?.name).toBe('Basic Grid');
    expect(basicGrid?.style.backgroundImage).toContain('linear-gradient');
    expect(curatedPatternByCategory.geometric.some((pattern) => pattern.id === 'basic-grid')).toBe(
      true,
    );
  });
});
