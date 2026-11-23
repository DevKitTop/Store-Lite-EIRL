'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

// ColorScheme kept for rest of app, but not used by landing
export type ColorScheme = 'default' | 'medium' | 'high';

interface ThemeContextProps {
  theme: Theme;
  colorScheme: ColorScheme;
  effectiveTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  setColorScheme: (scheme: ColorScheme) => void;
}

const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

const THEME_CLASSES = [
  'light',
  'light-medium-contrast',
  'light-high-contrast',
  'dark',
  'dark-medium-contrast',
  'dark-high-contrast',
] as const;

function getThemeClass(currentTheme: 'light' | 'dark', colorScheme: ColorScheme) {
  if (colorScheme === 'medium') {
    return `${currentTheme}-medium-contrast`;
  }

  if (colorScheme === 'high') {
    return `${currentTheme}-high-contrast`;
  }

  return currentTheme;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [colorScheme, setColorSchemeState] = useState<ColorScheme>('default');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    try {
      const storedTheme = localStorage.getItem('app-theme') as Theme;
      const storedScheme = localStorage.getItem('app-color-scheme') as ColorScheme;

      if (storedTheme && ['light', 'dark', 'system'].includes(storedTheme)) {
        setThemeState(storedTheme);
      }

      if (storedScheme && ['default', 'medium', 'high'].includes(storedScheme)) {
        setColorSchemeState(storedScheme);
      }
    } catch (e) {
      console.warn('Failed to load theme settings from localStorage', e);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    localStorage.setItem('app-theme', theme);
    localStorage.setItem('app-color-scheme', colorScheme);

    const applyTheme = (currentTheme: 'light' | 'dark') => {
      setEffectiveTheme(currentTheme);
      document.body.classList.remove(...THEME_CLASSES);
      const className = getThemeClass(currentTheme, colorScheme);
      document.body.classList.add(className);
      document.documentElement.setAttribute('data-theme', currentTheme);
      document.documentElement.style.colorScheme = currentTheme;

      // Keep browser/PWA UI bar in sync with the resolved (possibly user-selected) theme.
      const themeColor = currentTheme === 'dark' ? '#101417' : '#f6fafe';
      const metaThemeColors = document.querySelectorAll('meta[name="theme-color"]');
      if (metaThemeColors.length === 0) {
        const meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        meta.setAttribute('content', themeColor);
        document.head.appendChild(meta);
      } else {
        metaThemeColors.forEach((meta) => {
          meta.setAttribute('content', themeColor);
          meta.removeAttribute('media');
        });
      }
    };

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = (e: MediaQueryListEvent | MediaQueryList) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };

      handleSystemThemeChange(mediaQuery);
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    }

    applyTheme(theme);
  }, [theme, colorScheme, mounted]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        colorScheme,
        effectiveTheme,
        setTheme: setThemeState,
        setColorScheme: setColorSchemeState,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
