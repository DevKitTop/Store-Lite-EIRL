import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface TermsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: TermsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) return { title: 'Términos y Condiciones' };

  return {
    title: `Términos y Condiciones — ${business.name}`,
    description: 'Términos y condiciones de compra de la tienda.',
    robots: { index: true, follow: true },
  };
}

export default async function TermsPage({ params }: TermsPageProps) {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return notFound();
  }

  const settings = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, business.id),
    columns: { preferences: true },
  });

  const content = (settings?.preferences as Record<string, unknown> | null)?.termsContent as
    | string
    | undefined;

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '48px 16px' }}>
      <h1
        style={{
          fontSize: '1.75rem',
          fontWeight: '700',
          marginBottom: '24px',
          color: 'var(--md-sys-color-on-surface)',
        }}
      >
        Términos y Condiciones
      </h1>

      {content ? (
        <div
          style={{
            whiteSpace: 'pre-wrap',
            lineHeight: '1.7',
            fontSize: '0.9375rem',
            color: 'var(--md-sys-color-on-surface-variant)',
          }}
        >
          {content}
        </div>
      ) : (
        <p
          style={{
            color: 'var(--md-sys-color-on-surface-variant)',
            fontSize: '0.9375rem',
          }}
        >
          El comercio aún no ha configurado esta página.
        </p>
      )}
    </div>
  );
}
