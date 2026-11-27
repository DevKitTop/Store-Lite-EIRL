import { requestStorefrontThemeSync, viewerSchemeCookieName } from '@/core/storefront/viewerScheme';
import { ThemeProvider, useTheme } from '@/shared/context/ThemeContext';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorefrontViewerTheme } from '../../app/[slug]/(app)/components/useStorefrontViewerTheme';

const SLUG = 'mystore';
const STORE_KEY = `storefront-theme-${SLUG}`;

const localStorageMock = (() => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => {
      store.clear();
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

const matchMediaMock = vi.fn((_query: string) => ({
  matches: false,
  media: '',
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  value: matchMediaMock,
  writable: true,
});

function setCookie(value: string) {
  document.cookie = `${viewerSchemeCookieName(SLUG)}=${value}; path=/`;
}

function clearCookie() {
  document.cookie = `${viewerSchemeCookieName(SLUG)}=; path=/; max-age=0`;
}

function cookieContains(value: string) {
  return document.cookie.split('; ').includes(`${viewerSchemeCookieName(SLUG)}=${value}`);
}

function createMediaQueryList({ matches = false } = {}) {
  return {
    matches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

function SyncHarness({ defaultScheme = 'light' }: { defaultScheme?: 'light' | 'dark' }) {
  const { viewerTheme, handleViewerThemeToggle } = useStorefrontViewerTheme({
    slug: SLUG,
    defaultScheme,
  });
  return (
    <>
      <output
        data-testid="theme-state"
        data-viewer={viewerTheme ?? 'null'}
        data-active={viewerTheme ?? defaultScheme}
      />
      <button type="button" onClick={handleViewerThemeToggle}>
        toggle-viewer
      </button>
    </>
  );
}

// Simulates the navbar toggle: it writes the global ThemeContext and forwards
// the resolved scheme to the active storefront viewer.
function GlobalThemeControl() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        requestStorefrontThemeSync(SLUG, next);
      }}
    >
      toggle-global
    </button>
  );
}

function themeState() {
  const el = screen.getByTestId('theme-state');
  return {
    viewer: el.getAttribute('data-viewer'),
    active: el.getAttribute('data-active'),
  };
}

describe('themeSyncConvergence', () => {
  beforeEach(() => {
    matchMediaMock.mockReset();
    matchMediaMock.mockReturnValue(createMediaQueryList());
    clearCookie();
  });

  afterEach(() => {
    clearCookie();
    localStorageMock.clear();
    document.body.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it('prefers the store cookie over a legacy localStorage value and the store default', async () => {
    setCookie('dark');
    localStorageMock.setItem(STORE_KEY, 'light');

    render(<SyncHarness defaultScheme="light" />);

    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'dark', active: 'dark' });
    });
    expect(cookieContains('dark')).toBe(true);
  });

  it('migrates a legacy localStorage value to the store cookie on mount', async () => {
    localStorageMock.setItem(STORE_KEY, 'dark');

    render(<SyncHarness defaultScheme="light" />);

    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'dark', active: 'dark' });
    });
    expect(cookieContains('dark')).toBe(true);
  });

  it('ignores the OS preference and uses the store default when no choice is stored', async () => {
    matchMediaMock.mockReturnValue(createMediaQueryList({ matches: true }));

    render(<SyncHarness defaultScheme="light" />);

    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'null', active: 'light' });
    });
    expect(matchMediaMock).not.toHaveBeenCalled();
  });

  it('viewer toggle never mutates the platform app theme', async () => {
    localStorageMock.setItem('app-theme', 'dark');
    setCookie('light');

    render(
      <ThemeProvider>
        <SyncHarness />
        <GlobalThemeControl />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'light', active: 'light' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-viewer' }));

    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'dark', active: 'dark' });
    });
    expect(localStorageMock.getItem('app-theme')).toBe('dark');
    expect(document.body.classList.contains('dark')).toBe(true);
  });

  it('global (navbar) changes propagate into the storefront viewer', async () => {
    localStorageMock.setItem('app-theme', 'light');
    setCookie('light');

    render(
      <ThemeProvider>
        <SyncHarness />
        <GlobalThemeControl />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'light', active: 'light' });
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-global' }));

    await waitFor(() => {
      expect(document.body.classList.contains('dark')).toBe(true);
    });
    await waitFor(() => {
      expect(themeState()).toEqual({ viewer: 'dark', active: 'dark' });
    });
    expect(cookieContains('dark')).toBe(true);
  });
});
