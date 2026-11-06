import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * The FOUC guard is an inline script in `<head>`. It used to be a raw
 * `<script>`, which React 19 warns about: a script rendered by React never
 * executes on the client. It now goes through `InlineScript`, Next's documented
 * pattern (`text/javascript` on the server, `text/plain` on the client), so the
 * assertions follow the source into the constant and check the component is
 * still inside `<head>`, before the stylesheet.
 */
describe('app/layout.tsx - FOUC prevention inline script', () => {
  const layoutPath = join(__dirname, 'layout.tsx');
  let layoutContent: string;
  let headContent: string;

  beforeAll(() => {
    layoutContent = readFileSync(layoutPath, 'utf-8');
    headContent = layoutContent.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';
  });

  it('should render the boot script inside head', () => {
    expect(headContent).toBeTruthy();
    expect(headContent).toMatch(/<InlineScript/);
    expect(headContent).toMatch(/html=\{THEME_BOOT_SCRIPT\}/);
  });

  it('should not render a raw script tag, which React never executes client-side', () => {
    expect(headContent).not.toMatch(/<script/);
  });

  it('should read localStorage.getItem for app-theme', () => {
    expect(layoutContent).toMatch(/localStorage\.getItem\(['"]app-theme['"]\)/);
  });

  it('should set document.documentElement.setAttribute for data-theme', () => {
    expect(layoutContent).toMatch(/document\.documentElement\.setAttribute\(['"]data-theme['"]/);
  });

  it('should handle system theme with matchMedia', () => {
    expect(layoutContent).toMatch(/matchMedia\(['"]\(prefers-color-scheme: dark\)['"]\)/);
  });

  it('should be placed before ThemeBoot and stylesheet links', () => {
    const scriptIndex = headContent.indexOf('<InlineScript');
    const themeBootIndex = headContent.indexOf('<ThemeBoot');
    const linkIndex = headContent.indexOf('<link');

    expect(scriptIndex).toBeGreaterThan(-1);
    if (themeBootIndex > -1) {
      expect(scriptIndex).toBeLessThan(themeBootIndex);
    }
    if (linkIndex > -1) {
      expect(scriptIndex).toBeLessThan(linkIndex);
    }
  });
});
