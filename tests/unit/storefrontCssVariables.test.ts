import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import { createDefaultStorefrontTheme } from '@/core/storefront/storefrontTheme';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function collectCssFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectCssFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith('.css')) files.push(fullPath);
  }
  return files;
}

function referencedStorefrontVars(): Set<string> {
  const storefrontRoot = path.resolve(process.cwd(), 'app/[slug]');
  const references = new Set<string>();
  for (const file of collectCssFiles(storefrontRoot)) {
    const css = readFileSync(file, 'utf8');
    for (const match of css.matchAll(/var\(\s*(--storefront-[a-z0-9-]+)/g)) {
      references.add(match[1]);
    }
  }
  return references;
}

describe('storefront theme CSS variable contract', () => {
  it('emits every storefront variable referenced by store CSS', () => {
    const base = createDefaultStorefrontTheme();
    const theme = {
      ...base,
      light: {
        ...base.light,
        background: {
          type: 'gradient' as const,
          colors: ['#ffffff', '#000000'],
          cssOverlay: {
            background: '#ffffff',
            backgroundImage: 'linear-gradient(#ffffff, #000000)',
            backgroundSize: '10px 10px',
            backgroundPosition: '0 0',
            backgroundRepeat: 'repeat',
            maskImage: 'linear-gradient(#000000, transparent)',
            maskSize: '10px 10px',
            maskPosition: '0 0',
            maskRepeat: 'repeat',
            maskComposite: 'source-over',
            backgroundBlendMode: 'normal',
            filter: 'none',
            opacity: '1',
            mixBlendMode: 'normal',
            animation: 'none',
            boxShadow: 'none',
            imageRendering: 'auto',
          },
        },
      },
    };

    const emitted = buildStorefrontThemeVars(theme, 'light');
    const missing = [...referencedStorefrontVars()].filter((name) => !(name in emitted));

    expect(missing).toEqual([]);
  });
});
