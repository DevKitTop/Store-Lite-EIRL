import { StorefrontThemeShell } from '@/app/[slug]/(app)/components/StorefrontThemeShell';
import { createDefaultStorefrontTheme } from '@/core/storefront';
import type * as ThemeVarsModule from '@/core/storefront/buildStorefrontThemeVars';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockUsePathname, mockBuildStorefrontThemeVars } = vi.hoisted(() => ({
  mockUsePathname: vi.fn(),
  mockBuildStorefrontThemeVars: vi.fn(),
}));

vi.mock('@/core/storefront/buildStorefrontThemeVars', async (importOriginal) => {
  const actual = (await importOriginal()) as ThemeVarsModule;
  return {
    ...actual,
    buildStorefrontThemeVars: (...args: Parameters<typeof actual.buildStorefrontThemeVars>) => {
      mockBuildStorefrontThemeVars(...args);
      return actual.buildStorefrontThemeVars(...args);
    },
  };
});
vi.mock('next/navigation', () => ({ usePathname: () => mockUsePathname() }));
vi.mock('next/dynamic', () => ({
  default: () =>
    function EditorStub() {
      return <button aria-label="Personalizar tienda" />;
    },
}));

function renderShell(
  pathname: string,
  canCustomizeStorefront: boolean,
  options: { isAdminView?: boolean; hasSavedTheme?: boolean } = {},
) {
  const { isAdminView = false, hasSavedTheme = true } = options;
  mockUsePathname.mockReturnValue(pathname);
  return render(
    <StorefrontThemeShell
      businessId="business-1"
      slug="demo-store"
      storefrontTheme={hasSavedTheme ? createDefaultStorefrontTheme() : undefined}
      defaultScheme="light"
      canCustomizeStorefront={canCustomizeStorefront}
      isAdminView={isAdminView}
    >
      <div data-testid="storefront-child">Storefront</div>
    </StorefrontThemeShell>,
  );
}

beforeEach(() => {
  document.cookie = 'storefront-theme-demo-store=; Max-Age=0; path=/';
  mockBuildStorefrontThemeVars.mockClear();
});

describe('StorefrontThemeShell', () => {
  it('does not build vars or emit a style attribute without a saved theme', () => {
    const { container } = renderShell('/demo-store', true, { hasSavedTheme: false });

    expect(container.querySelector('[data-storefront-theme]')?.getAttribute('style')).toBeNull();
    expect(mockBuildStorefrontThemeVars).not.toHaveBeenCalled();
  });

  it('shows the theme toggle to customers on the public home route', () => {
    renderShell('/demo-store', true);

    expect(screen.getByRole('button', { name: 'Cambiar a modo oscuro' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Personalizar tienda' })).toBeDefined();
  });

  it('hides the customer theme toggle from sellers but keeps the editor FAB', () => {
    renderShell('/demo-store', true, { isAdminView: true });

    expect(screen.queryByRole('button', { name: 'Cambiar a modo oscuro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambiar a modo claro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Personalizar tienda' })).toBeDefined();
  });

  it('applies the viewer toggle for customers on product routes', () => {
    renderShell('/demo-store/product/sku-1', true);

    const toggle = screen.getByRole('button', { name: 'Cambiar a modo oscuro' });
    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toBeDefined();
  });

  it('does not leak storefront theme or tools into platform routes', () => {
    const { container } = renderShell('/demo-store/dashboard', true);

    expect(container.querySelector('[data-storefront-theme]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cambiar a modo oscuro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Personalizar tienda' })).toBeNull();
  });

  it('shows the editor FAB on public routes regardless of customization access', () => {
    renderShell('/demo-store', false, { isAdminView: true });

    expect(screen.queryByRole('button', { name: 'Cambiar a modo oscuro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Personalizar tienda' })).toBeDefined();
  });

  it('restores the editor FAB to the top right while keeping the cart below it', () => {
    const componentsDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'app',
      '[slug]',
      '(app)',
      'components',
    );
    const shellCss = readFileSync(join(componentsDir, 'StorefrontThemeShell.module.css'), 'utf8');
    const editorCss = readFileSync(join(componentsDir, 'StorefrontEditor.module.css'), 'utf8');
    const cartSource = readFileSync(join(componentsDir, 'FloatingCartButton.tsx'), 'utf8');
    const editorSource = readFileSync(join(componentsDir, 'StorefrontEditor.tsx'), 'utf8');

    expect(editorCss).toContain('top: 24px');
    expect(editorCss).toContain('right: 24px');
    expect(editorCss).toMatch(/z-index:\s*900/);
    expect(shellCss).toContain('[data-floating-cart]');
    expect(shellCss).toContain('top: 88px');
    expect(shellCss).not.toContain('[data-editor] [data-editor-fab]');
    expect(shellCss).not.toContain('top: 152px');
    expect(cartSource).toContain('data-floating-cart');
    expect(editorSource).toContain('data-editor-fab');
  });
});
