import { replaceSlugInPath, resolveBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { whatsappChannels } from '@/core/database/schema';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { WhatsAppConnectButton } from '@/features/whatsapp/components/WhatsAppConnectButton';
import { DashboardHeader } from '../components/DashboardHeader';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';

import styles from './whatsapp.module.css';

interface WhatsAppPageProps {
  params: Promise<{ slug: string }>;
}

export default async function WhatsAppPage({ params }: WhatsAppPageProps) {
  const { slug } = await params;

  // 1. Fetch business core data
  const resolvedBusiness = await resolveBusinessSlug(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/dashboard/whatsapp`, slug, resolvedBusiness.canonicalSlug));
  }

  // 2. Get entitlements
  const entitlements = await getBusinessEntitlements(business.id);

  // 3. Fetch WhatsApp channel for this business
  const channel = await db.query.whatsappChannels.findFirst({
    where: eq(whatsappChannels.businessId, business.id),
    columns: {
      id: true,
      ycloudPhoneNumberId: true,
      wabaId: true,
      displayPhoneNumber: true,
      isActive: true,
      connectedAt: true,
      createdAt: true,
    },
  });

  return (
    <main className={styles.page}>
      <DashboardHeader
        businessName={business.name}
        businessId={business.id}
        logoUrl={business.logoUrl}
        entitlements={entitlements}
        planEndDate={null}
      />

      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.title}>WhatsApp Business</h1>
          <p className={styles.description}>
            Conecta tu número de WhatsApp para recibir y responder mensajes de tus clientes directamente desde el panel.
          </p>
        </div>

        {channel ? (
          <div className={styles.card}>
            <div className={styles.channelInfo}>
              <div className={styles.statusBadge}>
                <span className={`${styles.statusDot} ${channel.isActive ? styles.active : styles.inactive}`} />
                <span className={styles.statusText}>
                  {channel.isActive ? 'Conectado' : 'Pendiente de conexión'}
                </span>
              </div>

              <div className={styles.details}>
                {channel.displayPhoneNumber && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Número:</span>
                    <span className={styles.detailValue}>{channel.displayPhoneNumber}</span>
                  </div>
                )}
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>ID de canal:</span>
                  <span className={styles.detailValueMono}>{channel.ycloudPhoneNumberId}</span>
                </div>
                {channel.connectedAt && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Conectado:</span>
                    <span className={styles.detailValue}>
                      {new Date(channel.connectedAt).toLocaleDateString('es-PE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>

              {!channel.isActive && (
                <div className={styles.actions}>
                  <WhatsAppConnectButton
                    businessId={business.id}
                    className="w-full"
                    onSuccess={() => window.location.reload()}
                  />
                </div>
              )}

              {channel.isActive && (
                <div className={styles.actions}>
                  <button
                    className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
                    disabled
                  >
                    WhatsApp Conectado
                  </button>
                  <p className="text-center text-sm text-gray-500 mt-2">
                    Para reconectar, primero desconecta el número desde la configuración de WhatsApp Business en tu teléfono.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className={styles.card} style={{ textAlign: 'center' }}>
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <h2 className={styles.emptyTitle}>Sin WhatsApp conectado</h2>
              <p className={styles.emptyDescription}>
                Vincula tu número de WhatsApp Business para gestionar conversaciones con tus clientes desde este panel.
              </p>
              <WhatsAppConnectButton
                businessId={business.id}
                className="mt-4 w-full max-w-xs"
                onSuccess={() => window.location.reload()}
              />
            </div>
          </div>
        )}

        <div className={styles.infoSection}>
          <h3 className={styles.infoTitle}>¿Cómo funciona?</h3>
          <ul className={styles.infoList}>
            <li className={styles.infoItem}>
              <span className={styles.infoNumber}>1</span>
              <div>
                <p className={styles.infoItemTitle}>Embedded Signup</p>
                <p className={styles.infoItemDesc}>
                  Usamos el flujo oficial de Meta para vincular tu número sin salir de Store Lite.
                </p>
              </div>
            </li>
            <li className={styles.infoItem}>
              <span className={styles.infoNumber}>2</span>
              <div>
                <p className={styles.infoItemTitle}>Código de 6 dígitos</p>
                <p className={styles.infoItemDesc}>
                  Recibirás un código único que ingresarás en la app de WhatsApp Business.
                </p>
              </div>
            </li>
            <li className={styles.infoItem}>
              <span className={styles.infoNumber}>3</span>
              <div>
                <p className={styles.infoItemTitle}>Webhooks en tiempo real</p>
                <p className={styles.infoItemDesc}>
                  Los mensajes llegan instantáneamente a tu panel via webhooks de YCloud.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}