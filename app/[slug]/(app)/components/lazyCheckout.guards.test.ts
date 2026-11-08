import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- reading repository sources in a test
  return readFileSync(join(here, file), 'utf-8');
}

const sites: [string, string][] = [
  ['CartDrawer.tsx', 'isCheckoutOpen'],
  ['ProductPreviewSheet.tsx', 'isPaymentModalOpen'],
  [join('..', 'product', '[productId]', 'components', 'PurchaseActions.tsx'), 'isPaymentModalOpen'],
  [join('..', '..', '..', '(main)', 'home', 'components', 'ProductCard.tsx'), 'isCheckoutOpen'],
];

describe('lazy checkout cannot load before interaction', () => {
  it.each(sites)('%s initializes its gate to false', (file, gate) => {
    const declaration = read(file)
      .split('\n')
      .find((line) => line.includes(`const [${gate}, `));

    expect(declaration).toBeDefined();
    expect(declaration).toContain('useState(false)');
  });

  it('derives the ProductItemView gate from a controller state initialized to false', () => {
    expect(
      read(join('..', '..', '..', '(main)', 'home', 'components', 'ProductItemView.tsx')),
    ).toContain('isPaymentModalOpen');

    const controller = readFileSync(
      join(
        here,
        '..',
        '..',
        '..',
        '..',
        'src',
        'features',
        'products',
        'hooks',
        'useProductItemController.ts',
      ),
      'utf-8',
    );
    expect(controller).toMatch(/const \[isPaymentModalOpen, \w+\] = useState\(false\)/);
  });

  it.each(sites)('%s renders LazyCheckout behind a condition', (file) => {
    expect(read(file)).toMatch(/\{[^}]*&&[^}]*<LazyCheckout/s);
  });
});
