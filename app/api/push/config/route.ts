import { NextResponse } from 'next/server';

import { getVapidPublicKey } from '@/lib/push/webPushSender';

export const runtime = 'nodejs';

/** Public VAPID key only; the private key and subject never leave the server. */
export function GET() {
  const publicKey = getVapidPublicKey();

  if (!publicKey) {
    return NextResponse.json(
      { error: 'Push notifications are not configured.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json({ publicKey }, { headers: { 'Cache-Control': 'no-store' } });
}
