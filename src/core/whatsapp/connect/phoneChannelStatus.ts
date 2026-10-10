/**
 * WhatsApp channel connection-status normalization.
 *
 * YCloud reports phone-number statuses in UPPERCASE ('CONNECTED', 'DISCONNECTED',
 * 'REJECTED', 'DEREGISTERED'). Activation of a channel is a side-effectful,
 * one-way transition (isActive + connectedAt), so it MUST be triggered only by
 * the exact UPPERCASE 'CONNECTED' — never by a lowercase or unknown value that
 * could arrive from a legacy sender or a future provider.
 *
 * Every webhook write path that persists a YCloud phone status MUST run it
 * through `normalizePhoneChannelStatus` so stored `connection_status` values
 * never drift to uppercase and channels never activate spuriously.
 */

export type PhoneChannelStatus = 'pending' | 'connected' | 'failed';

const FAILED_STATUSES: ReadonlySet<string> = new Set(['DISCONNECTED', 'REJECTED', 'DEREGISTERED']);

export interface PhoneChannelStatusResult {
  connectionStatus: PhoneChannelStatus;
  isActive?: boolean;
  /** null when the channel is deactivated (failed) — the previous
   *  connection timestamp is cleared so no connected-but-failed
   *  contradiction can ever be observed. */
  connectedAt?: Date | null;
}

export function normalizePhoneChannelStatus(
  value: string | null | undefined,
): PhoneChannelStatusResult {
  if (value === 'CONNECTED') {
    return { connectionStatus: 'connected', isActive: true, connectedAt: new Date() };
  }

  if (value && FAILED_STATUSES.has(value)) {
    // 'failed' exists to drive retry: the channel MUST be deactivated
    // (isActive false) and any previous connection timestamp cleared, so
    // polling/UI never observe a connected-but-failed contradiction.
    return { connectionStatus: 'failed', isActive: false, connectedAt: null };
  }

  return { connectionStatus: 'pending' };
}
