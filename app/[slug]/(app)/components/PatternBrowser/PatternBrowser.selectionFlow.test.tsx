import { patternToCssOverlay, type StorefrontTheme } from '@/core/storefront/storefrontTheme';
import { getCuratedPatternById, type PatternCraftPattern } from '@/data/patterncraft/curated';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StorefrontEditor } from '../StorefrontEditor';
import { PatternBrowser } from './PatternBrowser';

const { mockUpdateTheme } = vi.hoisted(() => ({
  mockUpdateTheme: vi.fn(),
}));

vi.mock('@app/[slug]/(app)/settings/actions', () => ({
  updateStorefrontTheme: mockUpdateTheme,
}));

vi.mock('@/shared/components/ui/data-display/Icon', () => ({
  Icon: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

const pattern = getCuratedPatternById('aurora-edge-glow');
if (!pattern) throw new Error('Curated pattern fixture is missing');

const overlay = patternToCssOverlay({
  id: pattern.id,
  style: pattern.style as Record<string, unknown>,
});

const themeWithPattern = {
  version: 2 as const,
  fontFamily: 'google-sans',
  light: {
    palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    background: { type: 'solid' as const, colors: ['#ffffff'], cssOverlay: overlay },
  },
  dark: {
    palette: { primary: '#111111', secondary: '#222222', accent: '#333333' },
    background: { type: 'solid' as const, colors: ['#000000'] },
  },
} satisfies StorefrontTheme;

function renderBrowser(
  onSelect: (pattern: PatternCraftPattern) => void,
  onClear: (pattern: PatternCraftPattern) => void,
  currentPatternId?: string,
) {
  return render(
    <PatternBrowser
      open
      onClose={vi.fn()}
      onSelect={onSelect}
      onClear={onClear}
      currentPatternId={currentPatternId}
      colorScheme="dark"
    />,
  );
}

function EditorHarness() {
  const [theme, setTheme] = useState<StorefrontTheme>(themeWithPattern);
  return (
    <StorefrontEditor
      business={{ id: 'biz-1', slug: 'my-store' }}
      storefrontTheme={theme}
      onThemeChange={setTheme}
      onClose={vi.fn()}
      detectedColorScheme="light"
      currentScheme="light"
      defaultScheme="light"
    />
  );
}

describe('T33 pattern selection flow', () => {
  beforeEach(() => {
    mockUpdateTheme.mockReset();
    mockUpdateTheme.mockImplementation(async (_businessId, _slug, theme) => ({
      success: true,
      storefrontTheme: theme,
    }));
  });

  test('shows three category tabs', () => {
    renderBrowser(vi.fn(), vi.fn());

    const tabs = screen.getAllByRole('button', {
      name: /Gradientes|Geométricos|Decorativos|Efectos/,
    });
    expect(tabs).toHaveLength(3);
  });

  test('supports one select -> apply -> remove cycle', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const { rerender } = renderBrowser(onSelect, onClear);

    await user.click(screen.getByRole('button', { name: /Aurora Edge Glow/ }));
    await user.click(screen.getByRole('button', { name: 'Aplicar patrón' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(pattern);

    rerender(
      <PatternBrowser
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        onClear={onClear}
        currentPatternId={pattern.id}
        colorScheme="dark"
      />,
    );

    const clearButtons = screen.getAllByRole('button', { name: 'Quitar' });
    expect(clearButtons).toHaveLength(1);
    await user.click(clearButtons[0]);
    expect(onClear).toHaveBeenCalledWith(pattern);
  });

  test('keeps one Quitar path across editor and browser', () => {
    render(<EditorHarness />);

    expect(screen.queryAllByRole('button', { name: 'Quitar' })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Personalizar tienda' }));
    fireEvent.click(screen.getByRole('button', { name: /Cambiar patrón/ }));

    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });
});
