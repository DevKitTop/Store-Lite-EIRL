'use client';

import { useCallback, useEffect, useState } from 'react';

import { publicEnv } from '@/config/env.public';

import styles from './PwaInstallPrompt.module.css';

const DISMISS_KEY = 'pwa-install-prompt:dismissed';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if (window.matchMedia?.('(display-mode: window-controls-overlay)').matches) return true;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isDismissed(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Ignore storage failures; the prompt will stay non-blocking.
  }
}

/**
 * Install guidance for supporting browsers. Feature-flagged so it can ship
 * before the P2 service worker without forcing any install flow. It never
 * blocks login or core navigation and only appears after the browser fires
 * `beforeinstallprompt`.
 */
export default function PwaInstallPrompt() {
  const enabled = publicEnv.pwaInstallPrompt;
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!window.isSecureContext) return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => window.removeEventListener('load', register);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (isStandaloneDisplay() || isDismissed()) return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    const onInstalled = () => {
      setDeferredPrompt(null);
      setVisible(false);
      rememberDismissed();
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [enabled]);

  const dismiss = useCallback(() => {
    setVisible(false);
    setDeferredPrompt(null);
    rememberDismissed();
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } finally {
      setVisible(false);
      setDeferredPrompt(null);
      rememberDismissed();
    }
  }, [deferredPrompt]);

  if (!enabled || !visible || !deferredPrompt) return null;

  return (
    <aside className={styles.banner} role="status" aria-live="polite">
      <div className={styles.copy}>
        <p className={styles.title}>Instalar Store Lite</p>
        <p className={styles.text}>
          Agregá la app a tu pantalla de inicio para abrir tu negocio más rápido. Podés seguir
          usando la versión web cuando quieras.
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={dismiss}>
          Ahora no
        </button>
        <button type="button" className={styles.primary} onClick={install}>
          Instalar
        </button>
      </div>
    </aside>
  );
}
