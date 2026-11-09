'use server';

// =====================================================
// LEGAL — Server Actions
// =====================================================

import { db } from '@/core/database/client';
import { businesses, businessSettings, complaintBookRecords } from '@/core/database/schema';
import { requireAccessOnId } from '@/features/storage/actions/authz';
import type { ActionState } from '@/types/actions';
import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import type { z } from 'zod';

import { calculateComplaintScore, updateComplaintScore } from '@/lib/complaintScoring';
import { processComplaintSubmission } from '@/lib/deactivation';
import { logger, toErrorDetail } from '@/lib/logger';
import { complaintFormSchema, complaintResponseSchema, legalContentSchema } from './schemas';
import type { ComplaintRecord } from './types';

// =====================================================
// T4: saveLegalContent
// =====================================================

export async function saveLegalContent(
  businessId: string,
  slug: string,
  data: {
    termsContent?: string | null;
    returnsContent?: string | null;
    complaintContactEmail?: string | null;
  },
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'legal.edit');

    const parsed = legalContentSchema.safeParse(data);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message;
      return { success: false, error: firstError || 'Datos no válidos' };
    }

    const existingSettings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: { id: true, preferences: true },
    });

    const currentPreferences = (existingSettings?.preferences ?? {}) as Record<string, unknown>;
    const nextPreferences = {
      ...currentPreferences,
      ...(parsed.data.termsContent !== undefined && {
        termsContent: parsed.data.termsContent,
      }),
      ...(parsed.data.returnsContent !== undefined && {
        returnsContent: parsed.data.returnsContent,
      }),
      ...(parsed.data.complaintContactEmail !== undefined && {
        complaintContactEmail: parsed.data.complaintContactEmail,
      }),
    };

    if (existingSettings) {
      await db
        .update(businessSettings)
        .set({ preferences: nextPreferences, updatedAt: new Date() })
        .where(eq(businessSettings.businessId, businessId));
    } else {
      await db.insert(businessSettings).values({
        businessId,
        themeMode: 'light',
        contrastLevel: 'standard',
        preferences: nextPreferences,
      });
    }

    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/settings`);
    revalidatePath(`/${slug}/terminos`);
    revalidatePath(`/${slug}/devoluciones`);
    revalidatePath('/', 'layout');

    return { success: true, message: 'Contenido legal guardado correctamente.' };
  } catch (error) {
    logger.error('[legal] Error saving legal content:', { error: toErrorDetail(error) });
    if (error instanceof Error && error.message.includes('Forbidden')) {
      return { success: false, error: 'No tenés permisos para editar la información legal.' };
    }
    return { success: false, error: 'Error al guardar el contenido legal.' };
  }
}

// =====================================================
// Business day calculation helper
// =====================================================

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      added++;
    }
  }
  return result;
}

// =====================================================
// Shared complaint-record creation
// =====================================================
// Single source of truth for validation, honeypot, 24h
// rate-limit, ticket generation, persistence and the
// non-blocking confirmation email. Shared by the per-store
// path (submitComplaint) and the platform path
// (submitPlatformComplaint).

// Resolves the seeded platform business (migrations/0032) used as the
// storage target for the platform-level Libro de Reclamaciones.
const PLATFORM_BUSINESS_SLUG = 'devkittop';

type ComplaintActionState = ActionState & {
  ticketNumber?: string;
  emailFailed?: boolean;
  score?: number;
  tier?: 'verified' | 'under_review' | 'rejected';
  breakdown?: {
    linkedToOrder: boolean;
    buyerKycVerified: boolean;
    culqiChargeback: boolean;
    slaExpired: boolean;
    patternSimilar: boolean;
  };
};

async function createComplaintRecord(
  business: { id: string; name: string | null },
  formData: z.infer<typeof complaintFormSchema>,
): Promise<ComplaintActionState> {
  const parsed = complaintFormSchema.safeParse(formData);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      if (!fieldErrors[field]) {
        fieldErrors[field] = issue.message;
      }
    }
    return {
      success: false,
      error: 'Corregí los errores en el formulario.',
    };
  }

  const data = parsed.data;

  // 🕵️ Honeypot check: si el campo oculto tiene valor, es un bot →
  //     devolvemos éxito falso para no alertarlo
  if (data.fax) {
    return {
      success: true,
      ticketNumber: 'LR-0000-00000000-0000',
      emailFailed: false,
    };
  }

  const businessId = business.id;
  const businessName = business.name ?? 'Tienda';

  // ⏱️ Rate limiting: máximo 1 reclamo por email cada 24h
  const recentCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(complaintBookRecords)
    .where(
      and(
        eq(complaintBookRecords.businessId, businessId),
        eq(complaintBookRecords.consumerEmail, data.consumerEmail),
        sql`${complaintBookRecords.createdAt} > NOW() - INTERVAL '24 hours'`,
      ),
    );

  if (Number(recentCount[0]?.count ?? 0) > 0) {
    return {
      success: false,
      error:
        'Ya registraste un reclamo con este correo en las últimas 24 horas. Esperá antes de enviar otro.',
    };
  }

  // Generate ticket number: LR-{year}-{businessIdShort}-{seq}
  const year = new Date().getFullYear();
  const businessIdShort = businessId.replace(/-/g, '').slice(0, 8);

  const lastRecord = await db
    .select({ maxSeq: sql<string>`COALESCE(MAX(seq), '0')` })
    .from(complaintBookRecords)
    .where(
      and(
        eq(complaintBookRecords.businessId, businessId),
        sql`EXTRACT(YEAR FROM ${complaintBookRecords.createdAt}) = ${year}`,
      ),
    )
    .limit(1)
    .then((rows) => rows[0]?.maxSeq ?? '0');

  const nextSeq = String(Number(lastRecord) + 1).padStart(4, '0');
  const ticketNumber = `LR-${year}-${businessIdShort}-${nextSeq}`;

  // Calculate SLA deadline (15 business days)
  const slaDeadline = addBusinessDays(new Date(), 15);

  // Insert complaint record (exclude fax que es honeypot)
  const { fax: _fax, ...insertData } = data;
  const [record] = await db
    .insert(complaintBookRecords)
    .values({
      businessId,
      ticketNumber,
      consumerLastName: insertData.consumerLastName,
      consumerFirstName: insertData.consumerFirstName,
      consumerDocType: insertData.consumerDocumentType,
      consumerDocId: insertData.consumerDocumentId,
      consumerAddress: insertData.consumerAddress,
      consumerPhone: insertData.consumerPhone,
      consumerEmail: insertData.consumerEmail,
      minorAge: insertData.minorAge,
      guardianName: insertData.guardianName ?? null,
      contractDescription: insertData.contractDescription,
      claimedAmount: insertData.claimedAmount ? String(insertData.claimedAmount) : null,
      claimDescription: insertData.claimDescription,
      consumerRequest: insertData.consumerRequest,
      slaDeadline,
      status: 'pending',
    })
    .returning();

  // Attempt to send confirmation email (non-blocking)
  let emailFailed = false;
  try {
    const { render } = await import('@react-email/components');
    const { ComplaintConfirmationEmail } = await import('@/emails/ComplaintConfirmationEmail');
    const { sendEmail } = await import('@/lib/email/resend');

    const emailHtml = await render(
      ComplaintConfirmationEmail({
        businessName,
        ticketNumber,
        date: new Date().toLocaleDateString('es-PE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        consumerName: `${data.consumerFirstName} ${data.consumerLastName}`,
        claimDescription: data.claimDescription,
        claimedAmount: data.claimedAmount ?? undefined,
        slaDeadline: slaDeadline.toLocaleDateString('es-PE', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
      }),
    );

    await sendEmail({
      to: data.consumerEmail,
      subject: `Libro de Reclamaciones — Ticket ${ticketNumber}`,
      html: emailHtml,
    });

    // Mark email as sent
    await db
      .update(complaintBookRecords)
      .set({ emailSentAt: new Date() })
      .where(eq(complaintBookRecords.id, record.id));
  } catch (emailError) {
    logger.warn('[legal] Failed to send complaint confirmation email:', {
      error: toErrorDetail(emailError),
    });
    emailFailed = true;
  }

  // Calculate complaint score and check for deactivation triggers (feature flag guarded)
  let scoreResult: Awaited<ReturnType<typeof calculateComplaintScore>> | null = null;
  if (process.env.ENABLE_AUTO_DEACTIVATION === 'true') {
    try {
      scoreResult = await calculateComplaintScore(record.id, businessId);
      await updateComplaintScore(record.id, scoreResult);
      // Check for deactivation trigger (async, non-blocking)
      await processComplaintSubmission(record.id, businessId);
    } catch (scoringError) {
      logger.error('[legal] Error calculating complaint score:', {
        error: toErrorDetail(scoringError),
      });
      // Don't fail the complaint submission if scoring fails
    }
  }

  return {
    success: true,
    ticketNumber,
    emailFailed,
    score: scoreResult?.score ?? 0,
    tier: scoreResult?.tier ?? 'rejected',
    breakdown: scoreResult?.breakdown ?? {
      linkedToOrder: false,
      buyerKycVerified: false,
      culqiChargeback: false,
      slaExpired: false,
      patternSimilar: false,
    },
  };
}

// =====================================================
// T5: submitComplaint (per-store)
// =====================================================

export async function submitComplaint(
  slug: string,
  formData: z.infer<typeof complaintFormSchema>,
): Promise<
  ActionState & {
    ticketNumber?: string;
    emailFailed?: boolean;
    score?: number;
    tier?: 'verified' | 'under_review' | 'rejected';
    breakdown?: {
      linkedToOrder: boolean;
      buyerKycVerified: boolean;
      culqiChargeback: boolean;
      slaExpired: boolean;
      patternSimilar: boolean;
    };
  }
> {
  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.slug, slug),
      columns: { id: true, name: true },
    });

    if (!business) {
      return { success: false, error: 'Tienda no encontrada.' };
    }

    return createComplaintRecord(business, formData);
  } catch (error) {
    logger.error('[legal] Error submitting complaint:', { error: toErrorDetail(error) });
    return { success: false, error: 'Error al registrar el reclamo. Intentalo de nuevo.' };
  }
}

// =====================================================
// submitPlatformComplaint (platform / public LR)
// =====================================================
// Slug-free platform submission. Resolves the fixed platform
// business (PLATFORM_BUSINESS_SLUG) and delegates the shared
// createComplaintRecord helper. Public path → generic errors
// (no internal platform details leaked).

export async function submitPlatformComplaint(
  formData: z.infer<typeof complaintFormSchema>,
): Promise<
  ActionState & {
    ticketNumber?: string;
    emailFailed?: boolean;
    score?: number;
    tier?: 'verified' | 'under_review' | 'rejected';
    breakdown?: {
      linkedToOrder: boolean;
      buyerKycVerified: boolean;
      culqiChargeback: boolean;
      slaExpired: boolean;
      patternSimilar: boolean;
    };
  }
> {
  try {
    const business = await db.query.businesses.findFirst({
      where: eq(businesses.slug, PLATFORM_BUSINESS_SLUG),
      columns: { id: true, name: true },
    });

    if (!business) {
      return {
        success: false,
        error: 'Ocurrió un error al registrar tu reclamo. Intentalo de nuevo.',
      };
    }

    return await createComplaintRecord(business, formData);
  } catch (error) {
    logger.error('[legal] Error submitting platform complaint:', { error: toErrorDetail(error) });
    return { success: false, error: 'Error al registrar el reclamo. Intentalo de nuevo.' };
  }
}

// =====================================================
// T6: respondToComplaint
// =====================================================

// =====================================================
// getComplaints — fetch complaints for admin panel
// =====================================================

export async function getComplaints(
  businessId: string,
): Promise<{ success: true; complaints: ComplaintRecord[] } | { success: false; error: string }> {
  try {
    await requireAccessOnId(businessId, 'legal.edit');

    const records = await db
      .select({
        id: complaintBookRecords.id,
        ticketNumber: complaintBookRecords.ticketNumber,
        consumerFirstName: complaintBookRecords.consumerFirstName,
        consumerLastName: complaintBookRecords.consumerLastName,
        consumerEmail: complaintBookRecords.consumerEmail,
        claimDescription: complaintBookRecords.claimDescription,
        status: complaintBookRecords.status,
        createdAt: complaintBookRecords.createdAt,
        slaDeadline: complaintBookRecords.slaDeadline,
      })
      .from(complaintBookRecords)
      .where(
        and(
          eq(complaintBookRecords.businessId, businessId),
          sql`${complaintBookRecords.deletedAt} IS NULL`,
        ),
      )
      .orderBy(desc(complaintBookRecords.createdAt))
      .limit(50);

    return {
      success: true,
      complaints: records.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        slaDeadline: r.slaDeadline.toISOString(),
      })),
    };
  } catch (error) {
    logger.error('[legal] Error fetching complaints:', { error: toErrorDetail(error) });
    if (error instanceof Error && error.message.includes('Forbidden')) {
      return { success: false, error: 'No tenés permisos para ver reclamos.' };
    }
    return { success: false, error: 'Error al cargar los reclamos.' };
  }
}

export async function respondToComplaint(
  businessId: string,
  complaintId: string,
  response: string,
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'legal.edit');

    const parsed = complaintResponseSchema.safeParse({ response });
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message || 'Respuesta no válida.',
      };
    }

    // Fetch the complaint to verify it belongs to this business and is respondable
    const complaint = await db.query.complaintBookRecords.findFirst({
      where: and(
        eq(complaintBookRecords.id, complaintId),
        eq(complaintBookRecords.businessId, businessId),
      ),
      columns: { id: true, status: true },
    });

    if (!complaint) {
      return { success: false, error: 'Reclamo no encontrado.' };
    }

    if (complaint.status === 'responded') {
      return { success: false, error: 'Este reclamo ya fue respondido.' };
    }

    await db
      .update(complaintBookRecords)
      .set({
        status: 'responded',
        adminResponse: parsed.data.response,
        adminRespondedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(complaintBookRecords.id, complaintId));

    revalidatePath('/', 'layout');

    return { success: true, message: 'Respuesta registrada correctamente.' };
  } catch (error) {
    logger.error('[legal] Error responding to complaint:', { error: toErrorDetail(error) });
    if (error instanceof Error && error.message.includes('Forbidden')) {
      return { success: false, error: 'No tenés permisos para responder reclamos.' };
    }
    return { success: false, error: 'Error al registrar la respuesta.' };
  }
}

// =====================================================
// submitSupportRequest — Seller → Store_Lite support
// =====================================================

export async function submitSupportRequest(subject: string, message: string): Promise<ActionState> {
  try {
    const { sendEmail } = await import('@/lib/email/resend');

    await sendEmail({
      to: 'devkittopsac@gmail.com',
      subject: `[Soporte Store Lite] ${subject}`,
      html: `<p>Nuevo mensaje de soporte:</p><p><strong>Asunto:</strong> ${subject}</p><p><strong>Mensaje:</strong></p><p>${message.replace(/\n/g, '<br>')}</p>`,
    });

    return { success: true, message: 'Mensaje enviado correctamente.' };
  } catch (error) {
    logger.error('[legal] Error sending support request:', { error: toErrorDetail(error) });
    return { success: false, error: 'Error al enviar el mensaje de soporte.' };
  }
}
