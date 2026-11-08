import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading repository sources in a test
  return readFileSync(join(__dirname, file), 'utf-8');
}

describe('checkout stays off the critical path', () => {
  it('loads Checkout through next/dynamic without server rendering', () => {
    const source = read('lazyCheckout.ts');

    expect(source).toMatch(/from 'next\/dynamic'/);
    expect(source).toMatch(/dynamic\(\(\)\s*=>\s*import\('\.\/Checkout'\)/);
    expect(source).toMatch(/ssr:\s*false/);
  });

  it('does not prefetch the chunk before the page paints', () => {
    const source = read('lazyCheckout.ts');

    // Scheduling the import on load fired at 77 ms and pushed the observed
    // largest contentful paint from 566 ms to 838 ms in measurement.
    expect(source).not.toMatch(/requestIdleCallback/);
    expect(source).not.toMatch(/addEventListener\('load'/);
  });

  it.each([
    'CartDrawer.tsx',
    'ProductPreviewSheet.tsx',
    join('..', 'product', '[productId]', 'components', 'PurchaseActions.tsx'),
    join('..', '..', '..', '(main)', 'home', 'components', 'ProductCard.tsx'),
    join('..', '..', '..', '(main)', 'home', 'components', 'ProductItemView.tsx'),
  ])('%s does not statically import Checkout', (file) => {
    // A static import puts the checkout flow and the Culqi SDK on every
    // storefront page, although Checkout only mounts when someone buys.
    expect(read(file)).not.toMatch(/^import\s+Checkout\s+from/m);
  });
});
