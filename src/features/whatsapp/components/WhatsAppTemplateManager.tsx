'use client';

import { BASE_TEMPLATES } from '@/features/chat/constants/baseTemplates';
import { Button, CircularProgress, Dialog, Icon } from '@/shared/components/ui';
import { useCallback, useEffect, useState } from 'react';
import styles from './WhatsAppTemplateManager.module.css';

export type TemplateMetaStatus = 'pending' | 'approved' | 'rejected';
export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

export interface WhatsAppTemplate {
  id: string;
  channelId: string;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  metaStatus: TemplateMetaStatus;
  metaTemplateId: string | null;
  createdAt: string;
}

const TEMPLATE_STATUS_LABELS: Record<TemplateMetaStatus, string> = {
  approved: 'Aprobado',
  pending: 'Pendiente',
  rejected: 'Rechazado',
};

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  marketing: 'Marketing',
  utility: 'Utilidad',
  authentication: 'Autenticación',
};

const BASE_TEMPLATE_LABELS: Record<string, string> = {
  order_confirmed: 'Pedido confirmado',
  order_shipped: 'Pedido enviado',
  payment_reminder: 'Recordatorio de pago',
  delivery_update: 'Actualización de entrega',
};

const STATUS_BADGE_CLASSES: Record<TemplateMetaStatus, string> = {
  approved: styles.statusApproved,
  pending: styles.statusPending,
  rejected: styles.statusRejected,
};

interface WhatsAppTemplateManagerProps {
  channelId: string;
  open: boolean;
  onClose: () => void;
}

interface SyncResponse {
  synced: number;
  total: number;
  errors: string[];
  results: { name: string; metaStatus: string; metaTemplateId: string | null }[];
}

// ─── Pure helpers (unit-testable) ───────────────────────────

export function templateStatusLabel(status: TemplateMetaStatus): string {
  return TEMPLATE_STATUS_LABELS[status] ?? status;
}

export function categoryLabel(category: TemplateCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function formatTemplateDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

export function baseTemplateLabel(name: string): string {
  return BASE_TEMPLATE_LABELS[name] ?? name;
}

export function isBaseTemplateCreated(templates: WhatsAppTemplate[], baseName: string): boolean {
  return templates.some((template) => template.name === baseName);
}

// ─── Manager ────────────────────────────────────────────────

export function WhatsAppTemplateManager({ channelId, open, onClose }: WhatsAppTemplateManagerProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/seller/whatsapp/templates?channelId=${encodeURIComponent(channelId)}`,
      );
      const data = (await response.json()) as { templates?: WhatsAppTemplate[]; error?: string };
      if (!response.ok) {
        setError(data.error ?? 'No se pudo cargar los templates');
        return;
      }
      setTemplates(data.templates ?? []);
    } catch {
      setError('No se pudo cargar los templates');
    } finally {
      setIsLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (open && channelId) {
      void loadTemplates();
    }
  }, [open, channelId, loadTemplates]);

  const handleCreateFromBase = async (baseTemplateName: string) => {
    if (isBaseTemplateCreated(templates, baseTemplateName)) return;

    setCreatingName(baseTemplateName);
    setError(null);
    try {
      const response = await fetch('/api/seller/whatsapp/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId, baseTemplateName }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'No se pudo crear el template');
        return;
      }
      await loadTemplates();
    } catch {
      setError('No se pudo crear el template');
    } finally {
      setCreatingName(null);
    }
  };

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setSyncSummary(null);
    try {
      const response = await fetch('/api/seller/whatsapp/templates/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId }),
      });
      const data = (await response.json()) as Partial<SyncResponse> & { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'No se pudo sincronizar los templates');
        return;
      }
      const synced = data.synced ?? 0;
      const total = data.total ?? 0;
      const errorCount = data.errors?.length ?? 0;
      setSyncSummary(
        errorCount > 0
          ? `Sincronizados ${synced} de ${total} (${errorCount} con error)`
          : `Sincronizados ${synced} de ${total}`,
      );
      await loadTemplates();
    } catch {
      setError('No se pudo sincronizar los templates');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <div slot="headline">Plantillas de WhatsApp</div>
      <div slot="content" className={styles.content}>
        <div className={styles.syncRow}>
          <Button variant="outlined" disabled={isSyncing || isLoading} onClick={handleSync}>
            <Icon slot="icon">sync</Icon>
            {isSyncing ? 'Sincronizando...' : 'Sincronizar estado'}
          </Button>
          {syncSummary && <span className={styles.syncSummary}>{syncSummary}</span>}
        </div>

        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}

        <h3 className={styles.sectionTitle}>Tus plantillas</h3>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <CircularProgress indeterminate />
          </div>
        ) : templates.length === 0 ? (
          <p className={styles.emptyText}>Aún no hay plantillas creadas.</p>
        ) : (
          <ul className={styles.templateList}>
            {templates.map((template) => (
              <li key={template.id} className={styles.templateItem}>
                <div className={styles.templateInfo}>
                  <span className={styles.templateName}>{template.name}</span>
                  <div className={styles.templateMeta}>
                    <span className={styles.categoryChip}>{categoryLabel(template.category)}</span>
                    <span className={styles.metaItem}>{template.language}</span>
                    <span className={styles.metaItem}>
                      {formatTemplateDate(template.createdAt)}
                    </span>
                  </div>
                </div>
                <span
                  className={`${styles.statusBadge} ${STATUS_BADGE_CLASSES[template.metaStatus]}`}
                >
                  {templateStatusLabel(template.metaStatus)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <h3 className={styles.sectionTitle}>Crear desde plantilla base</h3>
        <div className={styles.baseList}>
          {BASE_TEMPLATES.map((base) => {
            const exists = isBaseTemplateCreated(templates, base.name);
            const isCreating = creatingName === base.name;
            return (
              <div key={base.name} className={styles.baseItem}>
                <div className={styles.baseInfo}>
                  <span className={styles.baseName}>{baseTemplateLabel(base.name)}</span>
                  <span className={styles.baseBody}>{base.body}</span>
                </div>
                <Button
                  variant="tonal"
                  disabled={exists || isCreating}
                  onClick={() => void handleCreateFromBase(base.name)}
                >
                  {isCreating ? 'Creando...' : exists ? 'Creado' : 'Crear'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
      <div slot="actions">
        <Button variant="text" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </Dialog>
  );
}