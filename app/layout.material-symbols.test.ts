import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('app/layout.tsx - Material Symbols link', () => {
  const layoutPath = join(__dirname, 'layout.tsx');
  let layoutContent: string;

  beforeAll(() => {
    layoutContent = readFileSync(layoutPath, 'utf-8');
  });

  it('should have Material Symbols Rounded Google Fonts link in head', () => {
    expect(layoutContent).toMatch(
      /<link[^>]*rel="stylesheet"[^>]*href="https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Rounded/,
    );
  });

  it('should request a single weight instead of every variable axis', () => {
    // Requesting opsz+wght+FILL+GRAD serves the full 5.3 MB variable font.
    // `wght@400` serves the same glyphs in ~365 KB and nothing in the app sets
    // those axes, so the rendered icons are unchanged.
    expect(layoutContent).toMatch(/Material\+Symbols\+Rounded:wght@400&display=block/);
    expect(layoutContent).not.toMatch(/opsz,wght,FILL,GRAD@/);
  });

  it('should be placed in the head section', () => {
    const headMatch = layoutContent.match(/<head>([\s\S]*?)<\/head>/);
    expect(headMatch).toBeTruthy();
    if (headMatch) {
      expect(headMatch[1]).toMatch(/Material\+Symbols\+Rounded/);
    }
  });
});
