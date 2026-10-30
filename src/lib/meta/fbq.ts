'use client';

import { publicEnv } from '@/config/env.public';

/**
 * Minimal typed shape of Meta's `fbq` global.
 *
 * Once `fbevents.js` loads it becomes a callable carrying `callMethod`; before
 * that it is a queue function carrying `queue` (Meta's own bootstrap order:
 * queue first, replay on load). Both shapes are accepted here.
 */
export interface MetaFbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: MetaFbq;
  loaded?: boolean;
  version?: string;
}

declare global {
  interface Window {
    fbq?: MetaFbq;
  }
}

let initialized = false;

/**
 * Defines `window.fbq` as a command queue when the library is not loaded yet.
 * Mirrors Meta's queue semantics: commands pushed while the library is still
 * loading are replayed automatically once `fbevents.js` arrives.
 */
function ensureFbqQueue(): void {
  if (window.fbq?.queue || window.fbq?.callMethod) return;
  const queueFn: MetaFbq = function (this: unknown, ...args: unknown[]) {
    if (queueFn.callMethod) queueFn.callMethod(...args);
    else queueFn.queue?.push(args);
  };
  queueFn.queue = [];
  queueFn.push = queueFn;
  queueFn.loaded = true;
  queueFn.version = '2.0';
  window.fbq = queueFn;
}

/**
 * Initializes the pixel exactly once per page with the configured Pixel ID.
 * No-op during SSR, without a configured pixel id, or when already
 * initialized (guards against double-init on repeated mounts / hot reloads).
 */
export function initFbq(pixelId: string = publicEnv.metaPixelId): void {
  if (typeof window === 'undefined' || initialized || !pixelId) return;
  ensureFbqQueue();
  window.fbq?.('init', pixelId);
  initialized = true;
}

/**
 * Fires a `track` event, race-condition safe:
 * - no-op during SSR and before `initFbq` — events only fire after init;
 * - if the library has not finished loading, the command is queued and
 *   replayed automatically once it does.
 */
export function trackEvent(name: string, data?: Record<string, unknown>, eventID?: string): void {
  if (typeof window === 'undefined' || !initialized || !window.fbq) return;
  const payload = eventID !== undefined ? { ...data, eventID } : data;
  if (payload === undefined) {
    window.fbq('track', name);
  } else {
    window.fbq('track', name, payload);
  }
}
