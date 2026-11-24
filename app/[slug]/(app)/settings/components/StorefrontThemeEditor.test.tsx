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

vi.mock('@app/[slug]/(app)/settings/hooks/useSettingsState', () => ({
  useSnackbarFeedback: () => ({
    feedback: { open: false },
    showSuccess: vi.fn(),
    showError: vi.fn(),
    close: vi.fn(),
  }),
}));

vi.mock('@app/[slug]/(app)/settings/constants', () => ({
  THEME_COLOR_FIELDS: [],
  getFontFamilyCSS: () => 'sans-serif',
  getSelectValue: (event: unknown) => (event as { target: { value: string } }).target.value,
}));

vi.mock('@/shared/components/ui', () => ({
  AlertSnackbar: () => null,
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
} as never;

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
});
