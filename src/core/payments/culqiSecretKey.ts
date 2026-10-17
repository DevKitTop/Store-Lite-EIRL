// =====================================================
// src/core/payments/culqiSecretKey.ts
// =====================================================
// Single source of truth for resolving a business's Culqi secret key.
//
// The stored value is CIPHERTEXT (see `@/utils/crypto`), so it MUST be
// decrypted before use. Resolving also applies the environment guards that the
// original inline copy in `app/api/payment/charge/route.ts` enforced:
//   - production requires a live key (`sk_live...`)
//   - non-production must NOT use a live key
// Returning the raw ciphertext, or skipping these guards, silently produces a
// key Culqi rejects (or, worse, an accidental live charge from a dev machine).
// =====================================================

import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import { decrypt } from '@/utils/crypto';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function resolveCulqiSecretKey(
  businessId: string,
): Promise<{ secretKey: string; error: NextResponse | null }> {
  const settings = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, businessId),
    columns: { culqiSecretKey: true },
  });

  if (!settings?.culqiSecretKey) {
    return {
      secretKey: '',
      error: NextResponse.json(
        { error: 'El negocio no tiene configurada pasarela de pagos' },
        { status: 400 },
      ),
    };
  }

  const secretKey = decrypt(settings.culqiSecretKey);
  const isProd = process.env.NODE_ENV === 'production';
  const isKeyLive = secretKey.startsWith('sk_live');

  if (isProd && !isKeyLive) {
    return {
      secretKey: '',
      error: NextResponse.json(
        { error: 'Configuración inválida: Se requiere una llave de producción (sk_live).' },
        { status: 400 },
      ),
    };
  }

  if (!isProd && isKeyLive) {
    return {
      secretKey: '',
      error: NextResponse.json(
        {
          error: 'Configuración inválida: No se permiten llaves sk_live en entorno de desarrollo.',
        },
        { status: 400 },
      ),
    };
  }

  return { secretKey, error: null };
}
