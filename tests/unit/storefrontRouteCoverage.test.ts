import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(process.cwd());
const storeRoot = join(repoRoot, 'app', '[slug]');
const scopedLayout = join(storeRoot, '(app)', 'layout.tsx');

const read = (absolutePath: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readFileSync(absolutePath, 'utf8');

function collectPages(directory: string): string[] {
  const pages: string[] = [];
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...collectPages(fullPath));
    } else if (entry.name === 'page.tsx') {
      pages.push(fullPath);
    }
  }
  return pages;
}

function routeGroup(page: string): string | undefined {
  return relative(storeRoot, dirname(page))
    .split(sep)
    .find((segment) => segment === '(app)' || segment === '(public)');
}

function routePath(page: string): string {
  const segments = relative(storeRoot, dirname(page))
    .split(sep)
    .flatMap((segment) => {
      if (segment.startsWith('(.)')) return [segment.slice(3)];
      if (segment.startsWith('(') || segment.startsWith('@')) return [];
      return [segment];
    });

  return `/${segments.join('/')}`;
}

function repoRelative(page: string): string {
  return relative(repoRoot, page).split(sep).join('/');
}

const REQUIRED_THEMED_ROUTES = [
  '/',
  '/product/[productId]',
  '/order/[token]',
  '/order/verify/[orderNumber]',
  '/settings',
  '/notifications',
  '/chat',
  '/ayuda',
  '/soporte',
  '/storage',
];

const KNOWN_UNSCOPED_PUBLIC_ROUTES = new Set([
  '/terminos',
  '/libro-reclamaciones',
  '/devoluciones',
]);

describe('T30 storefront route coverage', () => {
  it('keeps every /[slug] page inside the scoped storefront route group', () => {
    const layout = read(scopedLayout);

    expect(layout).toContain('<StorefrontThemeScope');
    expect(layout).toContain('{children}');
    expect(layout).toContain('{modal}');

    const pages = collectPages(storeRoot);
    expect(pages.length).toBeGreaterThan(0);

    const themedRoutes = pages.filter((page) => routeGroup(page) === '(app)').map(routePath);
    for (const route of REQUIRED_THEMED_ROUTES) {
      expect(themedRoutes, `${route} must inherit the storefront scope`).toContain(route);
    }

    const unapprovedPages = pages
      .filter((page) => {
        const group = routeGroup(page);
        return group !== '(app)' && !KNOWN_UNSCOPED_PUBLIC_ROUTES.has(routePath(page));
      })
      .map(repoRelative);
    expect(unapprovedPages).toEqual([]);
  });
});
