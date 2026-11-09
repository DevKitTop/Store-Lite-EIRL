'use client';

import { getProductStats, getProductsForExport } from '@/features/business/actions/businessActions';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { Icon } from '@/shared/components/ui/data-display';
import { posthog } from 'posthog-js';
import React, { useCallback, useEffect, useState } from 'react';
import styles from '../BusinessSettingsModal.module.css';

interface ProductStats {
  productCount: number;
  categoryCount: number;
  lastProduct: {
    title: string;
    createdAt: string;
    price: string;
  } | null;
}

interface ProductosTabProps {
  businessId: string;
}

export const ProductosTab: React.FC<ProductosTabProps> = ({ businessId }) => {
  const [stats, setStats] = useState<ProductStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    getProductStats(businessId)
      .then((data) => {
        setStats(data);
        setLoading(false);
        return null;
      })
      .catch(() => {
        setLoading(false);
      });
  }, [businessId]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const XLSX = await import('xlsx');
      const { products, categorySummary } = await getProductsForExport(businessId);

      // Helper: auto-fit column width
      const maxLen = (arr: string[], idx: number) =>
        arr.length === 0 ? 10 : Math.max(...arr.map((row) => String(row[idx] ?? '').length));

      // ── Sheet 1: Productos ──
      const ws1Data = [
        ['Nombre del producto', 'Categoría', 'Stock'],
        ...products.map((p) => [p.title, p.category, p.stock]),
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(ws1Data);
      ws1['!cols'] = [
        {
          wch: Math.min(
            maxLen(
              products.map((p) => p.title),
              0,
            ) + 2,
            50,
          ),
        },
        {
          wch: Math.min(
            maxLen(
              products.map((p) => p.category),
              1,
            ) + 2,
            30,
          ),
        },
        { wch: 10 },
      ];

      // ── Sheet 2: Categorías ──
      const ws2Data = [
        ['Categoría', 'Cantidad'],
        ...categorySummary.map((c) => [c.name, c.productCount]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(ws2Data);
      ws2['!cols'] = [
        {
          wch: Math.min(
            maxLen(
              categorySummary.map((c) => c.name),
              0,
            ) + 2,
            30,
          ),
        },
        { wch: 14 },
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Productos');
      XLSX.utils.book_append_sheet(wb, ws2, 'Categorías');

      const date = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `productos_${date}.xlsx`);

      try {
        if (typeof posthog?.capture === 'function') {
          posthog.capture(AnalyticsEvents.EXPORT_DOWNLOADED, {
            type: 'products',
            businessId,
          });
        }
      } catch {
        // Analytics should never block user flow
      }
    } catch (error) {
      console.error('Error exporting products:', error);
    } finally {
      setIsDownloading(false);
    }
  }, [businessId, isDownloading]);

  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleDateString('es-PE', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.contentContainer}>
      <h2 className={styles.sectionTitle}>Productos</h2>
      <p className={styles.formHint}>Resumen rápido del catálogo de tu negocio.</p>

      {/* ── Stats Grid ── */}
      {loading ? (
        <div className={styles.metricsGrid}>
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.metricCard} style={{ opacity: 0.4 }}>
              <div className={styles.metricLabel}>Cargando...</div>
              <div className={styles.metricValue}>—</div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.metricsGrid}>
          <div className={styles.metricCard}>
            <div className={styles.metricLabel}>Productos</div>
            <div className={styles.metricValue}>{stats?.productCount ?? 0}</div>
          </div>

          <div className={styles.metricCard}>
            <div className={styles.metricLabel}>Categorías</div>
            <div className={styles.metricValue}>{stats?.categoryCount ?? 0}</div>
          </div>

          <div className={styles.metricCard}>
            <div className={styles.metricLabel}>Último producto</div>
            <div className={styles.metricValue} style={{ fontSize: '1rem', lineHeight: 1.3 }}>
              {stats?.lastProduct ? (
                <>
                  {stats.lastProduct.title}
                  <br />
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 400,
                      opacity: 0.65,
                    }}
                  >
                    {formatDate(stats.lastProduct.createdAt)}
                  </span>
                </>
              ) : (
                <span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.5 }}>
                  Sin productos aún
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Download Card ── */}
      <div className={styles.actionsCard}>
        <div className={styles.actionsCardInfo}>
          <div className={styles.actionsCardTitle}>Descargar catálogo</div>
          <div className={styles.actionsCardDesc}>
            Exporta todos tus productos a un archivo Excel (.xlsx).
          </div>
        </div>
        <md-outlined-button
          suppressHydrationWarning
          onClick={handleDownload}
          disabled={isDownloading}
        >
          <Icon slot="icon" size={18}>
            {isDownloading ? 'hourglass_top' : 'download'}
          </Icon>
          {isDownloading ? 'Generando...' : 'Descargar productos'}
        </md-outlined-button>
      </div>
    </div>
  );
};
