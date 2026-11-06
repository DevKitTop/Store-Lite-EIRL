/**
 * ticketCapture.ts
 *
 * Renders a receipt DOM node to a PNG blob in the browser.
 *
 * The blob is posted to the API, which is the only writer of the private
 * receipt bucket. The browser never talks to storage directly: receipts hold
 * buyer PII and must not be uploadable with the anonymous key.
 */

import { toPng } from 'html-to-image';
import type { RefObject } from 'react';

/** Fonts and images can paint after React commits; give them a beat. */
const DEFAULT_WAIT_MS = 800;

export interface TicketCaptureOptions {
  waitMs?: number;
}

/**
 * Captures a DOM ref as a PNG blob.
 *
 * @param ref - React ref to the DOM element to capture
 * @param options - Optional rendering delay override
 */
export async function captureTicketPng(
  ref: RefObject<HTMLDivElement | null>,
  options: TicketCaptureOptions = {},
): Promise<Blob> {
  if (!ref.current) {
    throw new Error('No se pudo generar el ticket');
  }

  await new Promise((resolve) => setTimeout(resolve, options.waitMs ?? DEFAULT_WAIT_MS));

  const dataUrl = await toPng(ref.current, {
    cacheBust: true,
    backgroundColor: '#ffffff',
    pixelRatio: 2,
    skipFonts: true,
    quality: 0.95,
  });

  if (!dataUrl) {
    throw new Error('No se pudo generar el ticket');
  }

  return fetch(dataUrl).then((response) => response.blob());
}
