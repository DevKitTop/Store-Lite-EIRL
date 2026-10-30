import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MetaPixelProvider from '@/components/meta/MetaPixelProvider';

import { COOKIE_NAME } from '@/lib/consent/consent';
import { trackPageView, trackViewContent } from '@/lib/meta/events';
import { initFbq } from '@/lib/meta/fbq';
import { isPlatformTrackingPage } from '@/lib/meta/tenantGuard';

// --- Mock state (hoisted so the vi.mock factories can reach it) ---
const { scriptProps, mockPathname, envState } = vi.hoisted(() => ({
  scriptProps: [] as Record<string, unknown>[],
  mockPathname: { current: '/' },
  envState: { metaPixelId: 'TEST_PIXEL' },
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
}));

vi.mock('next/script', () => ({
  default: (props: Record<string, unknown>) => {
    scriptProps.push(props);
    const testId = typeof props.id === 'string' ? props.id : 'pixel-script';
    return <script data-testid={testId} />;
  },
}));

vi.mock('@/config/env.public', () => ({
  publicEnv: envState,
}));

vi.mock('@/lib/meta/tenantGuard', () => ({
  isPlatformTrackingPage: vi.fn(),
}));

vi.mock('@/lib/meta/fbq', () => ({
  initFbq: vi.fn(),
  trackEvent: vi.fn(),
}));

vi.mock('@/lib/meta/events', () => ({
  trackPageView: vi.fn(),
  trackViewContent: vi.fn(),
}));

const mockedGuard = vi.mocked(isPlatformTrackingPage);

function clearCookies() {
  document.cookie.split(';').forEach((part) => {
    const name = part.trim().split('=')[0];
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  });
}

async function loadPixel() {
  const loader = scriptProps.find((p) => p.id === 'meta-pixel-loader');
  if (!loader) throw new Error('pixel loader script was not rendered');
  await act(async () => {
    (loader.onLoad as () => void)();
  });
}

describe('MetaPixelProvider', () => {
  beforeEach(() => {
    scriptProps.length = 0;
    mockPathname.current = '/';
    envState.metaPixelId = 'TEST_PIXEL';
    mockedGuard.mockReset();
    mockedGuard.mockReturnValue(true);
    vi.mocked(initFbq).mockReset();
    vi.mocked(trackPageView).mockReset();
    vi.mocked(trackViewContent).mockReset();
    clearCookies();
    document.cookie = `${COOKIE_NAME}=accepted; Path=/`;
  });

  afterEach(() => {
    clearCookies();
  });

  it('mounts the pixel scripts afterInteractive and fires PageView once the loader is ready', async () => {
    const { container } = render(<MetaPixelProvider />);

    expect(screen.getByTestId('meta-pixel-base')).toBeInTheDocument();
    expect(screen.getByTestId('meta-pixel-loader')).toBeInTheDocument();

    const base = scriptProps.find((p) => p.id === 'meta-pixel-base');
    expect(base).toMatchObject({ strategy: 'afterInteractive' });
    const baseHtml =
      (base?.dangerouslySetInnerHTML as { __html?: string } | undefined)?.__html ?? '';
    expect(baseHtml).toContain('fbq');

    const loader = scriptProps.find((p) => p.id === 'meta-pixel-loader');
    expect(loader).toMatchObject({
      strategy: 'afterInteractive',
      src: 'https://connect.facebook.net/en_US/fbevents.js',
    });

    // No events before the library reports ready.
    expect(trackPageView).not.toHaveBeenCalled();
    expect(initFbq).not.toHaveBeenCalled();

    await loadPixel();

    expect(initFbq).toHaveBeenCalledWith('TEST_PIXEL');
    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackViewContent).not.toHaveBeenCalled();
    expect(container.querySelector('noscript')).not.toBeNull();
  });

  it('fires ViewContent with Plan content when the page is under /pricing', async () => {
    mockPathname.current = '/pricing';
    render(<MetaPixelProvider />);

    await loadPixel();

    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackViewContent).toHaveBeenCalledWith({
      content_type: 'product',
      content_name: 'Plan',
    });
  });

  it('fires PageView again on route change and skips unchanged paths', async () => {
    const { rerender } = render(<MetaPixelProvider />);
    await loadPixel();
    expect(trackPageView).toHaveBeenCalledTimes(1);

    mockPathname.current = '/terminos';
    rerender(<MetaPixelProvider />);
    expect(trackPageView).toHaveBeenCalledTimes(2);

    rerender(<MetaPixelProvider />);
    expect(trackPageView).toHaveBeenCalledTimes(2);
  });

  it('fires PageView for the current route when navigation happens before the library is ready', async () => {
    const { rerender } = render(<MetaPixelProvider />);

    // Navigate while the pixel library is still loading: the firing effect
    // must observe the CURRENT pathname once `ready` lands — a navigation
    // during the load window must not be lost to a stale closure.
    mockPathname.current = '/pricing';
    rerender(<MetaPixelProvider />);

    await loadPixel();

    expect(trackPageView).toHaveBeenCalledTimes(1);
    expect(trackViewContent).toHaveBeenCalledWith({
      content_type: 'product',
      content_name: 'Plan',
    });
  });

  it('renders nothing when consent is declined', () => {
    document.cookie = `${COOKIE_NAME}=declined; Path=/`;
    const { container } = render(<MetaPixelProvider />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('meta-pixel-loader')).not.toBeInTheDocument();
    expect(initFbq).not.toHaveBeenCalled();
    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('renders nothing when consent is pending', () => {
    clearCookies();
    const { container } = render(<MetaPixelProvider />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('meta-pixel-loader')).not.toBeInTheDocument();
  });

  it('renders nothing on tenant hosts or /auth/customer (guard denies)', () => {
    mockedGuard.mockReturnValue(false);
    const { container } = render(<MetaPixelProvider />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('meta-pixel-loader')).not.toBeInTheDocument();
    expect(trackPageView).not.toHaveBeenCalled();
  });

  it('renders nothing when the pixel id is not configured', () => {
    envState.metaPixelId = '';
    const { container } = render(<MetaPixelProvider />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('meta-pixel-loader')).not.toBeInTheDocument();
  });
});
