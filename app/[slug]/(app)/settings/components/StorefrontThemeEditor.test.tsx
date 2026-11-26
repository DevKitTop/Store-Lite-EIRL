import type { StorefrontTheme } from '@/core/storefront';
import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import {
  resolveStorefrontFontFamily,
  type StorefrontFontFamily,
} from '@/core/storefront/storefrontFontRegistry';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StorefrontThemeEditor } from './StorefrontThemeEditor';

const { mockUpdateTheme, mockUpdateScheme, mockClearTheme } = vi.hoisted(() => ({
  mockUpdateTheme: vi.fn(),
  mockUpdateScheme: vi.fn(),
  mockClearTheme: vi.fn(),
}));

vi.mock('@app/[slug]/(app)/settings/actions', () => ({
  updateStorefrontTheme: mockUpdateTheme,
  updateStorefrontDefaultScheme: mockUpdateScheme,
  clearStorefrontTheme: mockClearTheme,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock('@/shared/components/ui/ThemeSettings', () => ({
  ThemeSettings: () => null,
}));

vi.mock('@app/[slug]/(app)/settings/hooks/useSettingsState', async () => {
  const React = await import('react');
  return {
    useSnackbarFeedback: () => {
      const [feedback, setFeedback] = React.useState({
        open: false,
        description: '',
        color: 'success' as 'success' | 'error',
        icon: 'check_circle',
      });
      return {
        feedback,
        showSuccess: (description: string) =>
          setFeedback({ open: true, description, color: 'success', icon: 'check_circle' }),
        showError: (description: string) =>
          setFeedback({ open: true, description, color: 'error', icon: 'error' }),
        close: () => setFeedback((prev) => ({ ...prev, open: false })),
      };
    },
  };
});

vi.mock('@app/[slug]/(app)/settings/constants', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    THEME_COLOR_FIELDS: [],
    getSelectValue: (event: unknown) => (event as { target: { value: string } }).target.value,
  };
});

vi.mock('@/shared/components/ui', () => ({
  AlertSnackbar: ({
    open,
    description,
    autoCloseDuration,
    onClose,
  }: {
    open?: boolean;
    description: string;
    autoCloseDuration?: number;
    onClose?: () => void;
  }) => (
    <div data-testid="snackbar" data-auto-close={autoCloseDuration}>
      {open ? description : ''}
      {open && (
        <button type="button" aria-label="Cerrar aviso" onClick={onClose}>
          x
        </button>
      )}
    </div>
  ),
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Icon: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Select: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void;
    disabled?: boolean;
  }) => (
    <label>
      {label}
      <select aria-label={label} value={value} disabled={disabled} onChange={onChange}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
  Switch: ({ selected, onInput }: { selected: boolean; onInput?: () => void }) => (
    <input type="checkbox" checked={selected} onChange={onInput} />
  ),
}));

const business = { id: 'biz-1', slug: 'my-store', name: 'My Store' };
const entitlements = {
  canCustomizeStorefront: true,
  plan: 'lite_pago',
} as never;
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

function renderEditor(scheme: 'light' | 'dark' = 'light') {
  return render(
    <StorefrontThemeEditor
      business={business as never}
      entitlements={entitlements}
      initialStorefrontTheme={theme}
      initialHasCustomTheme
      initialScheme={scheme}
      isOwner
      permissions={[]}
    />,
  );
}

describe('StorefrontThemeEditor scheme semantics', () => {
  beforeEach(() => {
    mockUpdateTheme.mockResolvedValue({ success: true, storefrontTheme: theme });
    mockUpdateScheme.mockResolvedValue({ success: true });
    mockClearTheme.mockResolvedValue({ success: true });
  });

  test('default-scheme control is explicit and writes through its own action (T08)', async () => {
    renderEditor();

    const control = screen.getByLabelText('Esquema que verán tus visitantes');
    expect(control).toBeDefined();
    expect(screen.getByText(/No cambia el modo que usás para administrar/)).toBeDefined();

    fireEvent.change(control, { target: { value: 'dark' } });

    await waitFor(() => {
      expect(mockUpdateScheme).toHaveBeenCalledWith('biz-1', 'my-store', 'dark');
    });
    expect(mockUpdateTheme).not.toHaveBeenCalled();
  });

  test('saving the palette never forwards the editing tab (T07)', async () => {
    renderEditor('dark');

    const fontControl = screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement;
    const alternative = Array.from(fontControl.querySelectorAll('option')).find(
      (option) => (option as HTMLOptionElement).value !== fontControl.value,
    );
    expect(alternative).toBeDefined();
    fireEvent.change(fontControl, { target: { value: (alternative as HTMLOptionElement).value } });

    fireEvent.click(screen.getByRole('button', { name: /Guardar apariencia pública/ }));

    await waitFor(() => {
      expect(mockUpdateTheme).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateTheme.mock.calls[0]).toHaveLength(3);
    expect(mockUpdateScheme).not.toHaveBeenCalled();
  });

  test('discard restores the saved snapshot and disables Save (T21)', () => {
    renderEditor();

    const save = screen.getByRole('button', {
      name: /Sin cambios pendientes|Guardar apariencia pública/,
    });
    expect(save).toHaveProperty('disabled', true);

    const fontControl = screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement;
    const originalFont = fontControl.value;
    const alternative = Array.from(fontControl.querySelectorAll('option')).find(
      (option) => (option as HTMLOptionElement).value !== originalFont,
    );
    expect(alternative).toBeDefined();
    fireEvent.change(fontControl, { target: { value: (alternative as HTMLOptionElement).value } });

    expect(screen.getByRole('button', { name: /Guardar apariencia pública/ })).toHaveProperty(
      'disabled',
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));

    expect((screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement).value).toBe(
      originalFont,
    );
    expect(screen.getByRole('button', { name: /Sin cambios pendientes/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  test('error feedback persists until dismissed and errors disable auto-close (T21)', async () => {
    mockUpdateTheme.mockResolvedValueOnce({
      success: false,
      error: 'No se pudo guardar la apariencia pública.',
    });
    renderEditor();

    const fontControl = screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement;
    const alternative = Array.from(fontControl.querySelectorAll('option')).find(
      (option) => (option as HTMLOptionElement).value !== fontControl.value,
    );
    fireEvent.change(fontControl, { target: { value: (alternative as HTMLOptionElement).value } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar apariencia pública/ }));

    await waitFor(() => {
      expect(screen.getByText('No se pudo guardar la apariencia pública.')).toBeDefined();
    });
    expect(screen.getByTestId('snackbar')).toHaveProperty('dataset.autoClose', '0');

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(screen.queryByText('No se pudo guardar la apariencia pública.')).toBeNull();
  });

  test('font preview uses the same resolved value as the storefront (T18)', () => {
    renderEditor();

    const previewCard = screen.getByText('Vista previa').closest('div');
    expect(previewCard).not.toBeNull();

    const storeValue = buildStorefrontThemeVars(theme, 'light')['--storefront-font-family'];
    expect(previewCard?.style.fontFamily).toBe(storeValue);
    expect(previewCard?.style.fontFamily).toBe(resolveStorefrontFontFamily('google-sans'));
    expect(previewCard?.style.fontFamily).toContain('var(--font-google-sans-flex)');

    const fontControl = screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement;
    fireEvent.change(fontControl, { target: { value: 'poppins' } });

    const nextFont = 'poppins' satisfies StorefrontFontFamily;
    expect(previewCard?.style.fontFamily).toBe(
      buildStorefrontThemeVars({ ...theme, fontFamily: nextFont }, 'light')[
        '--storefront-font-family'
      ],
    );
    expect(previewCard?.style.fontFamily).toBe(resolveStorefrontFontFamily(nextFont));
    expect(previewCard?.style.fontFamily).toContain('var(--font-storefront-poppins)');
    expect(previewCard?.style.fontFamily).not.toBe('Poppins');
  });

  test('every font option previews the shipped variable-based value in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const rendered = renderEditor(scheme);
      const previewCard = screen.getByText('Vista previa').closest('div');
      expect(previewCard).not.toBeNull();
      const fontControl = screen.getByLabelText('Estilo de tipografía') as HTMLSelectElement;

      for (const value of ['google-sans', 'inter', 'roboto', 'poppins'] as StorefrontFontFamily[]) {
        fireEvent.change(fontControl, { target: { value } });
        const expected = buildStorefrontThemeVars({ ...theme, fontFamily: value }, scheme)[
          '--storefront-font-family'
        ];
        expect(previewCard?.style.fontFamily).toBe(expected);
        expect(expected).toContain('var(--');
        expect(previewCard?.style.fontFamily).not.toBe(value);
        expect(['Google Sans', 'Inter', 'Roboto', 'Poppins']).not.toContain(
          previewCard?.style.fontFamily,
        );
      }
      rendered.unmount();
    }
  });
});
