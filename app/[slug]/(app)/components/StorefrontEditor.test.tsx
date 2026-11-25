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

vi.mock('./PatternBrowser', () => ({
  PatternBrowser: () => null,
}));

const initialTheme = {
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
};

function EditorHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [theme, setTheme] = useState(initialTheme);
  return (
    <>
      <StorefrontEditorHarness theme={theme} setTheme={setTheme} onClose={onClose} />
      <output data-testid="theme-primary">{theme.light.palette.primary}</output>
    </>
  );
}

function StorefrontEditorHarness({
  theme,
  setTheme,
  onClose,
}: {
  theme: typeof initialTheme;
  setTheme: (theme: typeof initialTheme) => void;
  onClose: () => void;
}) {
  return (
    <StorefrontEditor
      business={{ id: 'biz-1', slug: 'my-store' }}
      storefrontTheme={theme as never}
      onThemeChange={(next) => setTheme(next as typeof initialTheme)}
      onClose={onClose}
      detectedColorScheme="light"
      currentScheme="light"
      defaultScheme="light"
    />
  );
}

async function openAndDirtyPrimary(container: HTMLElement, value = '#ff0000') {
  fireEvent.click(screen.getByRole('button', { name: 'Personalizar tienda' }));
  const colorInputs = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="color"]'),
  );
  const primaryInput = colorInputs.find((input) => input.value === '#111111');
  expect(primaryInput).toBeDefined();
  fireEvent.change(primaryInput as HTMLInputElement, { target: { value } });
  await waitFor(() => {
    expect(screen.getByTestId('theme-primary').textContent).toBe(value);
  });
}

const saveButton = () =>
  screen.getByRole('button', { name: /Guardar cambios|Guardando\.\.\.|Sin cambios pendientes/ });

describe('StorefrontEditor dirty state (T21)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockUpdateTheme.mockReset();
    mockUpdateTheme.mockImplementation(async (_businessId, _slug, theme) => ({
      success: true,
      storefrontTheme: theme,
    }));
  });

  test('clean → dirty → save → clean', async () => {
    const { container } = render(<EditorHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Personalizar tienda' }));

    expect(saveButton()).toHaveProperty('disabled', true);
    expect(screen.getByText('Sin cambios pendientes')).toBeDefined();

    await openAndDirtyPrimary(container);

    expect(saveButton()).toHaveProperty('disabled', false);
    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(mockUpdateTheme).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(saveButton()).toHaveProperty('disabled', true);
    });
    expect(screen.getByText('Sin cambios pendientes')).toBeDefined();
  });

  test('discard restores the saved snapshot', async () => {
    const { container } = render(<EditorHarness />);
    await openAndDirtyPrimary(container);

    expect(screen.getByTestId('theme-primary').textContent).toBe('#ff0000');
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));

    await waitFor(() => {
      expect(screen.getByTestId('theme-primary').textContent).toBe('#111111');
    });
    expect(saveButton()).toHaveProperty('disabled', true);
  });

  test('close-with-changes asks for confirmation and discards on confirm', async () => {
    const onClose = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = render(<EditorHarness onClose={onClose} />);
    await openAndDirtyPrimary(container);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar editor' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar editor' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('theme-primary').textContent).toBe('#111111');
    });
  });

  test('failed save keeps the error visible and keeps changes until dismissed', async () => {
    mockUpdateTheme.mockResolvedValue({
      success: false,
      error: 'No se pudo guardar la apariencia pública.',
    });
    const { container } = render(<EditorHarness />);
    await openAndDirtyPrimary(container);

    fireEvent.click(saveButton());

    await waitFor(() => {
      expect(screen.getByText('No se pudo guardar la apariencia pública.')).toBeDefined();
    });
    expect(screen.getByTestId('theme-primary').textContent).toBe('#ff0000');
    expect(saveButton()).toHaveProperty('disabled', false);

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(screen.queryByText('No se pudo guardar la apariencia pública.')).toBeNull();
    expect(screen.getByTestId('theme-primary').textContent).toBe('#ff0000');
  });

  test('retry clears the previous error', async () => {
    mockUpdateTheme
      .mockResolvedValueOnce({
        success: false,
        error: 'No se pudo guardar la apariencia pública.',
      })
      .mockResolvedValueOnce({ success: true, storefrontTheme: initialTheme });
    const { container } = render(<EditorHarness />);
    await openAndDirtyPrimary(container);

    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.getByText('No se pudo guardar la apariencia pública.')).toBeDefined();
    });

    fireEvent.click(saveButton());
    await waitFor(() => {
      expect(screen.queryByText('No se pudo guardar la apariencia pública.')).toBeNull();
    });
    expect(mockUpdateTheme).toHaveBeenCalledTimes(2);
  });
});
