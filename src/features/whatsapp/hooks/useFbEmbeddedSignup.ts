// =====================================================
// useFbEmbeddedSignup.ts
//
// Lazy Facebook SDK loader + WA_EMBEDDED_SIGNUP message listener used by
// the WhatsApp coexistence modal. The SDK script is injected exactly once
// (module-cached promise) and the load is kicked as soon as the hook mounts,
// so by the time the seller clicks "Continuar con Meta" the SDK is ready
// and FB.login runs synchronously inside the click gesture (popup-safe).
// =====================================================

'use client';

import { env } from '@/config/env';
import { useCallback, useEffect, useRef } from 'react';
import {
  parseEmbeddedSignupEvent,
  type EmbeddedSignupFinishPayload,
} from '../lib/embeddedSignupEvents';

declare global {
  interface Window {
    FB?: {
      init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (callback: (response: unknown) => void, options: object) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const FB_SDK_SCRIPT_ID = 'facebook-jssdk';
const FB_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const FB_API_VERSION = 'v21.0';

/** Module-level promise cache — the SDK script is injected exactly once. */
let fbSdkPromise: Promise<void> | null = null;

function loadFbSdk(appId: string): Promise<void> {
  if (window.FB) return Promise.resolve();

  if (fbSdkPromise) return fbSdkPromise;

  fbSdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = FB_SDK_SCRIPT_ID;
    script.src = FB_SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';

    // The FB SDK calls fbAsyncInit when it finishes loading; that is where
    // FB.init can safely run (FB.login throws before init).
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        cookie: false,
        xfbml: false,
        version: FB_API_VERSION,
      });
      resolve();
    };

    script.onload = () => {
      // Guard: if the SDK raced (fbAsyncInit never fired) but window.FB is
      // available, the load still succeeded — resolve. Otherwise fail loudly.
      if (!window.FB) {
        fbSdkPromise = null;
        reject(new Error('Failed to load Facebook SDK'));
      }
    };

    script.onerror = () => {
      fbSdkPromise = null;
      reject(new Error('Failed to load Facebook SDK'));
    };

    document.head.appendChild(script);
  });

  return fbSdkPromise;
}

export interface UseFbEmbeddedSignupOptions {
  onFinish: (payload: EmbeddedSignupFinishPayload) => void;
  onError: (message: string | null) => void;
  onCancel: () => void;
}

/**
 * Provides the coexistence popup launch + event handling.
 * - Kicks the FB SDK load on mount (cached; injected once).
 * - Registers a 'message' listener that only reacts to allowlisted
 *   WA_EMBEDDED_SIGNUP events (origin guard in embeddedSignupEvents.ts).
 * - `launch` runs FB.login with the embedded-signup config; safe to call
 *   from a click handler right after the SDK load was kicked at mount.
 */
export function useFbEmbeddedSignup({ onFinish, onError, onCancel }: UseFbEmbeddedSignupOptions) {
  // Callbacks live in a ref so the mount-time listener stays stable and the
  // latest handlers are always used, even after re-renders.
  const callbacksRef = useRef({ onFinish, onError, onCancel });
  useEffect(() => {
    callbacksRef.current = { onFinish, onError, onCancel };
  });

  // Kick the SDK load at modal open so FB.login stays inside the gesture.
  useEffect(() => {
    if (!env.ycloudFbAppId) return;
    loadFbSdk(env.ycloudFbAppId).catch((err: Error) => {
      console.error('[useFbEmbeddedSignup] Failed to load FB SDK:', err);
    });
  }, []);

  // Listen for the embedded signup postMessage protocol.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupEvent(event);
      if (!parsed) return;

      if (parsed.kind === 'finish') {
        callbacksRef.current.onFinish(parsed.payload);
      } else if (parsed.kind === 'error') {
        callbacksRef.current.onError(parsed.message);
      } else {
        callbacksRef.current.onCancel();
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const launch = useCallback(async () => {
    const { ycloudFbAppId, ycloudFbConfigId, ycloudFbSolutionId } = env;
    if (!ycloudFbAppId || !ycloudFbConfigId || !ycloudFbSolutionId) {
      callbacksRef.current.onError('Configuración de WhatsApp incompleta');
      return;
    }

    try {
      await loadFbSdk(ycloudFbAppId);
    } catch {
      callbacksRef.current.onError('No se pudo cargar el SDK de Facebook');
      return;
    }

    if (!window.FB?.login) {
      callbacksRef.current.onError('No se pudo cargar el SDK de Facebook');
      return;
    }

    // The popup outcome arrives via postMessage (WA_EMBEDDED_SIGNUP), so the
    // login callback only needs to exist; the response payload is unused.
    // The Embedded Signup config requires the solution ID NESTED under
    // `setup` (C2) — a top-level `solutionID` is silently ignored by Meta.
    window.FB.login(() => {}, {
      config_id: ycloudFbConfigId,
      response_type: 'code',
      override_default_response_type: true,
      extras: {
        setup: { solutionID: ycloudFbSolutionId },
        sessionInfoVersion: 3,
        featureType: 'whatsapp_business_app_onboarding',
      },
    });
  }, []);

  return { launch };
}
