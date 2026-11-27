import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

function readCss(relativePath: string): string {
  // Fixed test fixtures, not user-controlled paths.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(join(projectRoot, relativePath), 'utf-8');
}

function ruleBlock(file: string, selector: string): string {
  const selectorAt = file.indexOf(selector);
  expect(selectorAt, `missing selector: ${selector}`).toBeGreaterThanOrEqual(0);
  const openBrace = file.indexOf('{', selectorAt);
  const closeBrace = file.indexOf('}', openBrace);
  return file.slice(openBrace + 1, closeBrace);
}

const surfaces = [
  {
    name: 'storefront editor panel',
    path: 'app/[slug]/(app)/components/StorefrontEditor.module.css',
    selector: '.panel',
    surfaceVar: 'surface-container-high',
  },
  {
    name: 'storefront navbar',
    path: 'src/styles/components/navbar.css',
    selector: '[data-storefront-theme] .navbar',
    surfaceVar: 'surface-container-low',
  },
  {
    name: 'product preview sheet',
    path: 'app/[slug]/(app)/components/ProductPreviewSheet.module.css',
    selector: '.sheet:global(.md-sheet)',
    surfaceVar: 'surface-container-low',
  },
];

describe('storefront translucent surface readability', () => {
  it.each(surfaces)(
    'blurs $name behind a fallback opaque background',
    ({ path, selector, surfaceVar }) => {
      const css = readCss(path);
      const block = ruleBlock(css, selector);

      expect(block).toContain(`--md-sys-color-${surfaceVar}-rgb`);
      expect(block).toMatch(/rgba\(var\(--md-sys-color-[\w-]+-rgb[^)]*\),\s*0\.9\d*\)/);
      expect(block).toMatch(/backdrop-filter:\s*blur\(/);
    },
  );
});
