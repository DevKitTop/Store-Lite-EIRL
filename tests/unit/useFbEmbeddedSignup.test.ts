// =====================================================
// useFbEmbeddedSignup — Instagram/WhatsApp coexistence popup hook
// =====================================================
// Covers: lazy FB SDK injection exactly once (module-cached promise),
// FB.login called with the embedded-signup config (config_id,
// response_type code, extras setup.solutionID/sessionInfoVersion/featureType),
// message listener registered on mount and removed on unmount, and the
// WA_EMBEDDED_SIGNUP events (JSON-string wire, top-level UPPERCASE event)
// routed to onFinish/onError/onCancel only when they come from an allowlisted
// origin.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FB_APP_ID = 'app-111';
const FB_CONFIG_ID = 'config-222';
const FB_SOLUTION_ID = 'solution-333';
const FB_ORIGIN = 'https://www.facebook.com';

function stubFbEnv() {
  vi.stubEnv('NEXT_PUBLIC_YCLOUD_FB_APP_ID', FB_APP_ID);
  vi.stubEnv('NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID', FB_CONFIG_ID);
  vi.stubEnv('NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID', FB_SOLUTION_ID);
}

/** Simulates the FB SDK script finishing its load. */
function fireFbAsyncInit() {
  (window as { fbAsyncInit?: () => void }).fbAsyncInit?.();
}

/** Real Meta wire shape: event.data is a JSON string; `event` is UPPERCASE. */
function embeddedSignupMessage(origin: string, event: string, inner?: unknown): MessageEvent {
  return new MessageEvent('message', {
    origin,
    data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data: inner ?? null }),
  });
}

describe('useFbEmbeddedSignup', () => {
  beforeEach(() => {
    stubFbEnv();
    vi.resetModules();
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as { FB?: unknown }).FB;
    delete (window as { fbAsyncInit?: () => void }).fbAsyncInit;
  });

  afterEach(() => {
    document.querySelectorAll('script').forEach((s) => s.remove());
    delete (window as { FB?: unknown }).FB;
    delete (window as { fbAsyncInit?: () => void }).fbAsyncInit;
  });

  it('injects the FB SDK script once and reuses the cached promise', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const { result } = renderHook(() =>
      useFbEmbeddedSignup({ onFinish: vi.fn(), onError: vi.fn(), onCancel: vi.fn() }),
    );

    // Mount effect already kicked the SDK load: exactly one script element.
    const scripts = document.querySelectorAll<HTMLScriptElement>('script#facebook-jssdk');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://connect.facebook.net/en_US/sdk.js');
    expect(scripts[0].async).toBe(true);
    expect(scripts[0].defer).toBe(true);
    expect(scripts[0].crossOrigin).toBe('anonymous');

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    await act(async () => {
      first = result.current.launch();
      second = result.current.launch();
    });

    // Concurrent launches must NOT create a second script element and both
    // must settle through the same cached SDK load.
    expect(document.querySelectorAll('script#facebook-jssdk')).toHaveLength(1);

    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> } }).FB = {
      init: vi.fn(),
      login: vi.fn(),
    };
    await act(async () => {
      fireFbAsyncInit();
      await first;
      await second;
    });

    expect(document.querySelectorAll('script#facebook-jssdk')).toHaveLength(1);

    expect((window as { FB?: { init: ReturnType<typeof vi.fn> } }).FB?.init).toHaveBeenCalledWith({
      appId: FB_APP_ID,
      cookie: false,
      xfbml: false,
      version: 'v21.0',
    });
  });

  it('calls FB.login with the embedded signup config in the launch gesture', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const login = vi.fn();
    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: typeof login } }).FB = {
      init: vi.fn(),
      login,
    };

    const { result } = renderHook(() =>
      useFbEmbeddedSignup({ onFinish: vi.fn(), onError: vi.fn(), onCancel: vi.fn() }),
    );

    await act(async () => {
      await result.current.launch();
    });

    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(expect.any(Function), {
      config_id: FB_CONFIG_ID,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: { solutionID: FB_SOLUTION_ID },
        sessionInfoVersion: 3,
        featureType: 'whatsapp_business_app_onboarding',
      },
    });
  });

  it('does not call FB.login when the Meta partner envs are missing', async () => {
    vi.unstubAllEnvs();
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const onError = vi.fn();
    const login = vi.fn();
    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: typeof login } }).FB = {
      init: vi.fn(),
      login,
    };

    const { result } = renderHook(() =>
      useFbEmbeddedSignup({ onFinish: vi.fn(), onError, onCancel: vi.fn() }),
    );

    await act(async () => {
      await result.current.launch();
    });

    expect(login).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('registers the message listener on mount and removes it on unmount', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useFbEmbeddedSignup({ onFinish: vi.fn(), onError: vi.fn(), onCancel: vi.fn() }),
    );

    expect(addSpy).toHaveBeenCalledWith('message', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('routes a FINISH message from facebook.com to onFinish with typed ids', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const onFinish = vi.fn();
    const onError = vi.fn();
    const onCancel = vi.fn();

    renderHook(() => useFbEmbeddedSignup({ onFinish, onError, onCancel }));

    await act(async () => {
      window.dispatchEvent(
        embeddedSignupMessage(FB_ORIGIN, 'FINISH', {
          business_id: 'biz-1',
          waba_id: 'waba-2',
          phone_number_id: 'pn-3',
        }),
      );
    });

    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({
      businessId: 'biz-1',
      wabaId: 'waba-2',
      phoneNumberId: 'pn-3',
    });
    expect(onError).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ignores FINISH messages from non-allowlisted origins', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const onFinish = vi.fn();
    const onError = vi.fn();
    const onCancel = vi.fn();

    renderHook(() => useFbEmbeddedSignup({ onFinish, onError, onCancel }));

    await act(async () => {
      window.dispatchEvent(
        embeddedSignupMessage('https://evil.example.com', 'FINISH', {
          business_id: 'biz-1',
          waba_id: 'waba-2',
          phone_number_id: 'pn-3',
        }),
      );
    });

    expect(onFinish).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('routes ERROR to onError with the message and cancel to onCancel', async () => {
    const { useFbEmbeddedSignup } = await import('@/features/whatsapp/hooks/useFbEmbeddedSignup');
    const onFinish = vi.fn();
    const onError = vi.fn();
    const onCancel = vi.fn();

    renderHook(() => useFbEmbeddedSignup({ onFinish, onError, onCancel }));

    await act(async () => {
      window.dispatchEvent(
        embeddedSignupMessage(FB_ORIGIN, 'ERROR', { error: { message: 'WABA no encontrado' } }),
      );
    });
    expect(onError).toHaveBeenCalledWith('WABA no encontrado');

    await act(async () => {
      window.dispatchEvent(embeddedSignupMessage(FB_ORIGIN, 'CANCEL'));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onFinish).not.toHaveBeenCalled();
  });
});
