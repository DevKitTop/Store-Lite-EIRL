import { patternToCssOverlay, type StorefrontTheme } from '@/core/storefront/storefrontTheme';
import { getPatternCraftById } from '@/data/patterncraft';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StorefrontEditor } from './StorefrontEditor';

const { mockUpdateTheme } = vi.hoisted(() => ({
  mockUpdateTheme: vi.fn(),
}));

vi.mock('@app/[slug]/(app)/settings/actions', () => ({
  updateStorefrontTheme: mockUpdateTheme,
}));

vi.mock('@/shared/components/ui/data-display/Icon', () => ({
  Icon: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

const pattern = getPatternCraftById('arctic-lights-glow');
if (!pattern) throw new Error('PatternCraft fixture is missing');

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

function Harness() {
  const [theme, setTheme] = useState<StorefrontTheme>(themeWithPattern);
  return (
    <>
      <StorefrontEditor
        business={{ id: 'biz-1', slug: 'my-store' }}
        storefrontTheme={theme}
        onThemeChange={setTheme}
        onClose={vi.fn()}
        detectedColorScheme="light"
        currentScheme="light"
        defaultScheme="light"
      />
      <output data-testid="overlay-id">
        {theme.light.background?.cssOverlay?.patternId ?? 'none'}
      </output>
    </>
  );
}

describe('StorefrontEditor pattern clearing (T22)', () => {
  beforeEach(() => {
    mockUpdateTheme.mockReset();
    mockUpdateTheme.mockImplementation(async (_businessId, _slug, theme) => ({
      success: true,
      storefrontTheme: theme,
    }));
  });

  test('Quitar removes the saved overlay from the working theme', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar tienda' }));

    expect(screen.getByTestId('overlay-id').textContent).toBe(pattern.id);
    fireEvent.click(screen.getByRole('button', { name: /Cambiar patrón/ }));

    const clearButtons = screen.getAllByRole('button', { name: 'Quitar' });
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    await waitFor(() => {
      expect(screen.getByTestId('overlay-id').textContent).toBe('none');
    });
  });
});
