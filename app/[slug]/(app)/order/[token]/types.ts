// =====================================================
// Order tracking — Shared types
// =====================================================
// Caller proof used by server actions to verify that
// the caller is the legitimate owner of the order.

/**
 * Proof of identity sent from client to server actions.
 * At least one of {dni, authId} must be present.
 */
export interface CallerProof {
  dni?: string;
  authId?: string;
}
