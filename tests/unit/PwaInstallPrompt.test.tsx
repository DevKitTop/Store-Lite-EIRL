import PwaInstallPrompt from '@/shared/components/pwa/PwaInstallPrompt';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function dispatchBeforeInstallPrompt() {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    platforms: ['web'],
    prompt,
    userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
  });
  window.dispatchEvent(event);
  return { prompt, event };
}

describe('PwaInstallPrompt', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_PWA_INSTALL_PROMPT', 'true');
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it('renders nothing when the feature flag is off', () => {
    vi.stubEnv('NEXT_PUBLIC_PWA_INSTALL_PROMPT', 'false');
    render(<PwaInstallPrompt />);
    act(() => {
      dispatchBeforeInstallPrompt();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders install guidance after beforeinstallprompt when enabled', () => {
    render(<PwaInstallPrompt />);
    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Instalar Store Lite')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instalar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ahora no' })).toBeInTheDocument();
  });

  it('dismisses and remembers the choice without installing', () => {
    render(<PwaInstallPrompt />);
    act(() => {
      dispatchBeforeInstallPrompt();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem('pwa-install-prompt:dismissed')).toBe('1');
  });

  it('prompts the browser install flow when the user accepts', async () => {
    render(<PwaInstallPrompt />);
    let prompt: ReturnType<typeof vi.fn>;
    act(() => {
      ({ prompt } = dispatchBeforeInstallPrompt());
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Instalar' }));
    });

    expect(prompt!).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem('pwa-install-prompt:dismissed')).toBe('1');
  });

  it('does not render when the app is already running standalone', () => {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    render(<PwaInstallPrompt />);
    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not render when the prompt was previously dismissed', () => {
    localStorage.setItem('pwa-install-prompt:dismissed', '1');

    render(<PwaInstallPrompt />);
    act(() => {
      dispatchBeforeInstallPrompt();
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
