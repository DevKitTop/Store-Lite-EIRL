import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import { Card } from '@/shared/components/ui';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComplaintForm } from './ComplaintForm';

interface ComplaintPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ComplaintPageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) return { title: 'Libro de Reclamaciones' };

  return {
    title: `Libro de Reclamaciones — ${business.name}`,
    description: 'Presenta un reclamo o queja formal según el DS 011-2011-PCM.',
    robots: { index: true, follow: true },
  };
}

export default async function ComplaintBookPage({ params }: ComplaintPageProps) {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return notFound();
  }

  const settings = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, business.id),
    columns: { preferences: true },
  });

  const preferences = (settings?.preferences ?? {}) as Record<string, unknown>;
  const complaintContactEmail = preferences.complaintContactEmail as string | undefined;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 16px' }}>
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: '700',
          marginBottom: '8px',
          color: 'var(--md-sys-color-on-surface)',
        }}
      >
        Libro de Reclamaciones
      </h1>
      <p
        style={{
          color: 'var(--md-sys-color-on-surface-variant)',
          fontSize: '0.9375rem',
          marginBottom: '24px',
          lineHeight: '1.5',
        }}
      >
        Completa el formulario con tus datos y los detalles del reclamo. La empresa tiene 15 días
        hábiles para responder, según lo establecido por el DS 011-2011-PCM y la Ley 29571.
      </p>

      {complaintContactEmail && (
        <Card
          variant="outlined"
          style={{
            padding: '1rem',
            marginBottom: '24px',
            backgroundColor: 'var(--md-sys-color-secondary-container)',
          }}
        >
          <p
            style={{
              margin: 0,
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-secondary-container)',
            }}
          >
            <strong>Contacto directo:</strong> Si prefieres, también puedes comunicarte directamente
            al{' '}
            <a
              href={`mailto:${complaintContactEmail}`}
              style={{ color: 'var(--md-sys-color-on-secondary-container)' }}
            >
              {complaintContactEmail}
            </a>
          </p>
        </Card>
      )}

      <ComplaintForm slug={slug} />
    </div>
  );
}
