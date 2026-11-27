'use client';

import type { RefObject } from 'react';
import { useCallback, useEffect, useRef } from 'react';

interface UseDialogSurfaceOptions {
  open: boolean;
  onClose: () => void;
  /** Suspend focus and keyboard handling while a nested surface owns input. */
  suspended?: boolean;
  /** Stop Escape from reaching parent document listeners (nested dialogs). */
  captureEscape?: boolean;
}

interface UseDialogSurfaceResult {
  surfaceRef: RefObject<HTMLDivElement | null>;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

export function useDialogSurface({
  open,
  onClose,
  suspended = false,
  captureEscape = false,
}: UseDialogSurfaceOptions): UseDialogSurfaceResult {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const getFocusableElements = useCallback((): HTMLElement[] => {
    const surface = surfaceRef.current;
    if (!surface) return [];
    return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (element) =>
        !element.hasAttribute('disabled') &&
        element.getAttribute('aria-hidden') !== 'true' &&
        element.tabIndex !== -1,
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    openerRef.current = document.activeElement as HTMLElement | null;
    surfaceRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || suspended) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (captureEscape) event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const surface = surfaceRef.current;
      const focusableElements = getFocusableElements();
      if (!surface || focusableElements.length === 0) {
        event.preventDefault();
        surface?.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !surface.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, captureEscape);
    return () => document.removeEventListener('keydown', handleKeyDown, captureEscape);
  }, [captureEscape, getFocusableElements, onClose, open, suspended]);

  return { surfaceRef };
}
