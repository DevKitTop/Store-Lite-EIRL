import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('app/layout.tsx - Fonts via next/font', () => {
  const layoutPath = join(__dirname, 'layout.tsx');
  let layoutContent: string;

  beforeAll(() => {
    layoutContent = readFileSync(layoutPath, 'utf-8');
  });

  describe('Self-hosted fonts (localFont)', () => {
    it('should NOT import any font from next/font/google', () => {
      expect(layoutContent).not.toMatch(/next\/font\/google/);
    });

    it('should import localFont from next/font/local', () => {
      expect(layoutContent).toMatch(/import\s+localFont\s+from\s*['"]next\/font\/local['"]/);
    });

    it('should define all six font families with localFont', () => {
      const localFontCalls = layoutContent.match(/localFont\(\{/g);
      expect(localFontCalls).toHaveLength(6);
    });
  });

  describe('Font CSS variables', () => {
    const variables = [
      '--font-sora',
      '--font-storefront-inter',
      '--font-storefront-roboto',
      '--font-roboto-mono',
      '--font-google-sans-flex',
      '--font-storefront-poppins',
    ];

    variables.forEach((variable) => {
      it(`should define variable ${variable}`, () => {
        expect(layoutContent).toMatch(new RegExp(`variable:\\s*['"]${variable}['"]`));
      });
    });
  });

  describe('Font display and fallback', () => {
    it('should set display: swap for all six fonts', () => {
      const swapMatches = layoutContent.match(/display:\s*['"]swap['"]/g);
      expect(swapMatches).toHaveLength(6);
    });

    it('should define fallback fonts', () => {
      expect(layoutContent).toMatch(/fallback:.*system-ui/);
    });
  });

  describe('html className', () => {
    it('should apply all six font variables to html className', () => {
      expect(layoutContent).toMatch(
        /\$\{sora\.variable\}\s+\$\{inter\.variable\}\s+\$\{roboto\.variable\}\s+\$\{roboto_mono\.variable\}\s+\$\{google_sans_flex\.variable\}\s+\$\{poppins\.variable\}/,
      );
    });
  });

  describe('Material Symbols icon font request', () => {
    it('should request only the 400 weight instead of every axis', () => {
      expect(layoutContent).toContain('Material+Symbols+Rounded:wght@400');
    });

    it('should not request the opsz/FILL/GRAD axes that inflate the font', () => {
      expect(layoutContent).not.toMatch(/Material\+Symbols\+Rounded:opsz,wght,FILL,GRAD/);
    });

    it('should keep display=block so ligature names never flash as text', () => {
      expect(layoutContent).toMatch(/Material\+Symbols\+Rounded[^"']*&display=block/);
    });
  });

  describe('tokens.css font token references', () => {
    const tokensPath = join(__dirname, '(main)/home/tokens.css');
    let tokensContent: string;

    beforeAll(() => {
      tokensContent = readFileSync(tokensPath, 'utf-8');
    });

    it('should NOT reference the deprecated --font-inter variable', () => {
      expect(tokensContent).not.toContain('var(--font-inter)');
    });

    it('should reference --font-storefront-inter for --font-plain', () => {
      expect(tokensContent).toContain('var(--font-storefront-inter)');
    });
  });
});
