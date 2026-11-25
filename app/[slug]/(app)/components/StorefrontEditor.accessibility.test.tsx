import type { StorefrontTheme } from '@/core/storefront/storefrontTheme';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StorefrontEditor } from './StorefrontEditor';

vi.mock('@app/[slug]/(app)/settings/actions', () => ({
  updateStorefrontTheme: vi.fn(),
}));

vi.mock('@/shared/components/ui/data-display/Icon', () => ({
  Icon: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const theme = {
  version: 2 as const,
  fontFamily: 'google-sans',
  light: {
    palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    background: { type: 'solid' as const, colors: ['#ffffff'] },
  },
  dark: {
    palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    background: { type: 'solid' as const, colors: ['#000000'] },
  },
} satisfies StorefrontTheme;

function Harness() {
  return (
    <StorefrontEditor
      business={{ id: 'biz-1', slug: 'my-store' }}
      storefrontTheme={theme}
      onThemeChange={vi.fn()}
      onClose={vi.fn()}
      detectedColorScheme="light"
      currentScheme="light"
      defaultScheme="light"
    />
  );
}

describe('StorefrontEditor accessible surface (T23)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('panel has dialog semantics when open and is inert when closed', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);

    const panel = container.querySelector<HTMLElement>('[data-testid="storefront-editor-panel"]');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('inert');
    expect(panel).toHaveAttribute('aria-hidden', 'true');

    const fab = screen.getByRole('button', { name: 'Personalizar tienda' });
    await user.click(fab);

    const dialog = screen.getByRole('dialog', { name: 'Personalizar tienda' });
    expect(dialog).toBe(panel);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'storefront-editor-title');
    expect(dialog).toHaveAttribute('tabindex', '-1');
    expect(dialog).not.toHaveAttribute('inert');
    expect(dialog).not.toHaveAttribute('aria-hidden');
    expect(document.activeElement).toBe(dialog);
  });

  test('Tab and Shift+Tab keep focus inside the open panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Personalizar tienda' }));

    const dialog = screen.getByRole('dialog', { name: 'Personalizar tienda' });
    for (let i = 0; i < 40; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 40; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  test('Escape and backdrop click both close the panel and restore focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const fab = screen.getByRole('button', { name: 'Personalizar tienda' });

    await user.click(fab);
    expect(screen.getByRole('dialog', { name: 'Personalizar tienda' })).toBeDefined();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Personalizar tienda' })).toBeNull();
    expect(document.activeElement).toBe(fab);

    await user.click(fab);
    const backdrop = container.querySelector<HTMLElement>(
      '[data-testid="storefront-editor-backdrop"]',
    );
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as HTMLElement);
    expect(screen.queryByRole('dialog', { name: 'Personalizar tienda' })).toBeNull();
    expect(document.activeElement).toBe(fab);
  });

  test('Escape closes the nested picker without closing the editor', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Personalizar tienda' }));
    const overlayToggle = screen.getByRole('checkbox');
    await user.click(overlayToggle);

    expect(screen.getByRole('dialog', { name: 'Patrones PatternCraft' })).toBeDefined();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Patrones PatternCraft' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Personalizar tienda' })).toBeDefined();
    expect(document.activeElement).toBe(overlayToggle);
  });
});
