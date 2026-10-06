/**
 * ticketService.ts
 *
 * Client-side service for ticket operations.
 * Delegates generation to the server-side API (no more client-side PNG capture).
 */

export interface ServerTicketResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Requests the server to generate a tamper-proof ticket PNG from the database.
 * The server reads the real order data, renders via Satori, uploads to Supabase,
 * and returns the public URL.
 *
 * The server accepts two proofs of access: an owner session, or the buyer's
 * `trackingToken` (design D3). `trackingToken` is optional and omitted from the
 * request body when the caller has none, so owner-authed callers keep sending
 * exactly the body they sent before.
 *
 * @param orderNumber - The order number to generate the ticket for
 * @param forceRegenerate - Ask the server to rebuild an existing ticket (owner-only)
 * @param trackingToken - The buyer's token, used as proof when there is no session
 * @returns The public URL of the generated ticket
 */
export async function requestServerTicket(
  orderNumber: string,
  forceRegenerate?: boolean,
  trackingToken?: string,
): Promise<ServerTicketResult> {
  const response = await fetch('/api/ticket/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderNumber, forceRegenerate, trackingToken }),
  });

  const data = await response.json();

  if (!response.ok) {
    return { success: false, error: data.error || 'Error generating ticket' };
  }

  return { success: true, publicUrl: data.publicUrl };
}

/**
 * Downloads a ticket image from a URL to the user's device.
 *
 * @param ticketUrl - Public URL of the ticket image
 * @param orderNumber - Used as the download filename
 */
export async function downloadTicketFromUrl(ticketUrl: string, orderNumber: string): Promise<void> {
  const response = await fetch(ticketUrl);
  const blob = await response.blob();
  const link = document.createElement('a');
  link.download = `ticket-${orderNumber}.png`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
}
