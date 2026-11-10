'use client';

// =====================================================
// ComplaintForm — Public Libro de Reclamaciones form
// =====================================================
// Fully public, no auth required. Submits via server action.
// =====================================================

import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { AlertSnackbar, Button, Card, Checkbox, Icon, TextField } from '@/shared/components/ui';
import posthog from 'posthog-js';
import { useCallback, useState, useTransition } from 'react';

interface ComplaintFormProps {
  slug: string;
}

type DocType = 'dni' | 'ce';
type Step = 'form' | 'success';

export function ComplaintForm({ slug }: ComplaintFormProps) {
  const [step, setStep] = useState<Step>('form');
  const [isPending, startTransition] = useTransition();
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);
  const [emailFailed, setEmailFailed] = useState(false);
  const [feedback, setFeedback] = useState<{
    open: boolean;
    description: string;
    color: 'success' | 'error';
  }>({ open: false, description: '', color: 'success' });

  // Form state
  const [formData, setFormData] = useState({
    consumerLastName: '',
    consumerFirstName: '',
    consumerDocumentType: 'dni' as DocType,
    consumerDocumentId: '',
    consumerAddress: '',
    consumerPhone: '',
    consumerEmail: '',
    minorAge: false,
    guardianName: '',
    contractDescription: '',
    claimedAmount: '',
    claimDescription: '',
    consumerRequest: '',
    fax: '',
  });

  // Field-level errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleChange = useCallback(
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }));
      setFieldErrors((prev) => {
        const { [field]: _, ...rest } = prev;
        return rest;
      });
    },
    [],
  );

  const handleCheckbox = useCallback(
    (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.checked }));
    },
    [],
  );

  const handleSubmit = () => {
    startTransition(async () => {
      // Client-side validation
      const errors: Record<string, string> = {};
      if (!formData.consumerLastName.trim())
        errors.consumerLastName = 'El apellido es obligatorio.';
      if (!formData.consumerFirstName.trim())
        errors.consumerFirstName = 'El nombre es obligatorio.';
      if (!formData.consumerDocumentId.trim())
        errors.consumerDocumentId = 'El documento es obligatorio.';
      if (!formData.consumerAddress.trim()) errors.consumerAddress = 'La dirección es obligatoria.';
      if (!formData.consumerPhone.trim()) errors.consumerPhone = 'El teléfono es obligatorio.';
      if (!formData.consumerEmail.trim()) {
        errors.consumerEmail = 'El correo es obligatorio.';
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.consumerEmail)) {
        errors.consumerEmail = 'Correo electrónico inválido.';
      }
      if (formData.minorAge && !formData.guardianName.trim())
        errors.guardianName = 'El nombre del apoderado es obligatorio.';
      if (!formData.contractDescription.trim())
        errors.contractDescription = 'La descripción del bien o servicio es obligatoria.';
      if (!formData.claimDescription.trim()) {
        errors.claimDescription = 'La descripción del reclamo es obligatoria.';
      } else if (formData.claimDescription.trim().length < 20) {
        errors.claimDescription = 'Debe tener al menos 20 caracteres.';
      }
      if (!formData.consumerRequest.trim())
        errors.consumerRequest = 'El pedido del consumidor es obligatorio.';

      if (Object.keys(errors).length > 0) {
        setFieldErrors(errors);
        setFeedback({
          open: true,
          description: 'Corrige los errores en el formulario.',
          color: 'error',
        });
        return;
      }

      const { submitComplaint } = await import('@/features/legal/actions');
      const res = await submitComplaint(slug, {
        consumerLastName: formData.consumerLastName.trim(),
        consumerFirstName: formData.consumerFirstName.trim(),
        consumerDocumentType: formData.consumerDocumentType,
        consumerDocumentId: formData.consumerDocumentId.trim(),
        consumerAddress: formData.consumerAddress.trim(),
        consumerPhone: formData.consumerPhone.trim(),
        consumerEmail: formData.consumerEmail.trim(),
        minorAge: formData.minorAge,
        guardianName: formData.guardianName.trim() || null,
        contractDescription: formData.contractDescription.trim(),
        claimedAmount: formData.claimedAmount ? parseFloat(formData.claimedAmount) : null,
        claimDescription: formData.claimDescription.trim(),
        consumerRequest: formData.consumerRequest.trim(),
        fax: formData.fax,
      });

      if (res.success) {
        posthog.capture(AnalyticsEvents.COMPLAINT_SUBMITTED, {
          store_slug: slug,
          has_claimed_amount: Boolean(formData.claimedAmount),
          is_minor: formData.minorAge,
          email_delivered: !res.emailFailed,
        });
        setTicketNumber(res.ticketNumber ?? null);
        setEmailFailed(res.emailFailed ?? false);
        setStep('success');
      } else {
        setFeedback({
          open: true,
          description: res.error ?? 'Error al registrar el reclamo.',
          color: 'error',
        });
      }
    });
  };

  // ── Success State ──
  if (step === 'success') {
    return (
      <Card variant="outlined" style={{ padding: '2rem', textAlign: 'center' }}>
        <Icon size={64} style={{ color: 'var(--md-sys-color-primary)', marginBottom: '1rem' }}>
          check_circle
        </Icon>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 8px' }}>
          Reclamo registrado
        </h2>
        <p style={{ color: 'var(--md-sys-color-on-surface-variant)', marginBottom: '1.5rem' }}>
          Tu reclamo fue recibido correctamente.
        </p>

        <div
          style={{
            backgroundColor: 'var(--md-sys-color-surface-container-high)',
            border: '1px solid var(--md-sys-color-outline-variant)',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1.5rem',
          }}
        >
          <p
            style={{
              fontSize: '0.8rem',
              color: 'var(--md-sys-color-on-surface-variant)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: 600,
              margin: '0 0 4px',
            }}
          >
            Código de reclamo
          </p>
          <p
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: 'var(--md-sys-color-primary)',
              margin: 0,
              fontFamily: 'monospace',
            }}
          >
            {ticketNumber}
          </p>
        </div>

        {emailFailed && (
          <div
            style={{
              backgroundColor: 'var(--md-sys-color-surface-variant)',
              border: '1px solid var(--md-sys-color-outline-variant)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '1rem',
            }}
          >
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--md-sys-color-on-surface-variant)',
                margin: 0,
              }}
            >
              No se pudo enviar el correo de confirmación, pero tu reclamo quedó registrado con
              éxito. Guarda el código para hacer seguimiento.
            </p>
          </div>
        )}

        <p style={{ fontSize: '0.875rem', color: 'var(--md-sys-color-on-surface-variant)' }}>
          La empresa tiene 15 días hábiles para responder. Si no recibes respuesta, puedes escalar
          al INDECOPI.
        </p>
      </Card>
    );
  }

  // ── Form State ──
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 🕵️ Honeypot: campo invisible para bots — los humanos no lo ven */}
      <input
        name="fax"
        type="text"
        value={formData.fax}
        onChange={handleChange('fax')}
        tabIndex={-1}
        autoComplete="off"
        style={{
          position: 'absolute',
          left: '-9999px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        }}
        aria-hidden="true"
      />

      {/* ── Consumer Data Section ── */}
      <Card variant="outlined" style={{ padding: '1.5rem' }}>
        <h3
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            margin: '0 0 1rem',
            color: 'var(--md-sys-color-on-surface)',
          }}
        >
          Datos del consumidor
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <TextField
                label="Apellidos"
                value={formData.consumerLastName}
                onInput={handleChange('consumerLastName')}
                error={!!fieldErrors.consumerLastName}
                supportingText={fieldErrors.consumerLastName}
              />
            </div>
            <div>
              <TextField
                label="Nombres"
                value={formData.consumerFirstName}
                onInput={handleChange('consumerFirstName')}
                error={!!fieldErrors.consumerFirstName}
                supportingText={fieldErrors.consumerFirstName}
              />
            </div>
          </div>

          <div>
            <div>
              <p
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--md-sys-color-on-surface-variant)',
                  marginBottom: '8px',
                }}
              >
                Tipo de documento
              </p>
              <div style={{ display: 'flex', gap: '1.5rem' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="radio"
                    name="docType"
                    checked={formData.consumerDocumentType === 'dni'}
                    onChange={() =>
                      setFormData((prev) => ({ ...prev, consumerDocumentType: 'dni' }))
                    }
                    style={{ accentColor: 'var(--md-sys-color-primary)' }}
                  />
                  DNI
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  <input
                    type="radio"
                    name="docType"
                    checked={formData.consumerDocumentType === 'ce'}
                    onChange={() =>
                      setFormData((prev) => ({ ...prev, consumerDocumentType: 'ce' }))
                    }
                    style={{ accentColor: 'var(--md-sys-color-primary)' }}
                  />
                  Carné de Extranjería
                </label>
              </div>
            </div>
          </div>

          <TextField
            label="Número de documento"
            value={formData.consumerDocumentId}
            onInput={handleChange('consumerDocumentId')}
            error={!!fieldErrors.consumerDocumentId}
            supportingText={fieldErrors.consumerDocumentId}
          />

          <TextField
            label="Dirección"
            value={formData.consumerAddress}
            onInput={handleChange('consumerAddress')}
            error={!!fieldErrors.consumerAddress}
            supportingText={fieldErrors.consumerAddress}
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <TextField
              label="Teléfono"
              value={formData.consumerPhone}
              onInput={handleChange('consumerPhone')}
              error={!!fieldErrors.consumerPhone}
              supportingText={fieldErrors.consumerPhone}
            />
            <TextField
              label="Correo electrónico"
              type="email"
              value={formData.consumerEmail}
              onInput={handleChange('consumerEmail')}
              error={!!fieldErrors.consumerEmail}
              supportingText={fieldErrors.consumerEmail}
            />
          </div>

          <div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              <Checkbox checked={formData.minorAge} onChange={handleCheckbox('minorAge')} />
              Soy menor de edad
            </label>
          </div>

          {formData.minorAge && (
            <TextField
              label="Nombre del apoderado o representante legal"
              value={formData.guardianName}
              onInput={handleChange('guardianName')}
              error={!!fieldErrors.guardianName}
              supportingText={fieldErrors.guardianName}
            />
          )}
        </div>
      </Card>

      {/* ── Claim Details Section ── */}
      <Card variant="outlined" style={{ padding: '1.5rem' }}>
        <h3
          style={{
            fontSize: '1rem',
            fontWeight: 600,
            margin: '0 0 1rem',
            color: 'var(--md-sys-color-on-surface)',
          }}
        >
          Detalle del reclamo
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <TextField
            label="Descripción del bien o servicio contratado"
            type="textarea"
            rows={3}
            value={formData.contractDescription}
            onInput={handleChange('contractDescription')}
            error={!!fieldErrors.contractDescription}
            supportingText={fieldErrors.contractDescription}
          />

          <TextField
            label="Monto reclamado (opcional)"
            type="number"
            value={formData.claimedAmount}
            onInput={handleChange('claimedAmount')}
            placeholder="0.00"
          />

          <TextField
            label="Descripción del reclamo"
            type="textarea"
            rows={4}
            value={formData.claimDescription}
            onInput={handleChange('claimDescription')}
            error={!!fieldErrors.claimDescription}
            supportingText={
              fieldErrors.claimDescription ||
              `Mínimo 20 caracteres — ${formData.claimDescription.length}/2000`
            }
          />

          <TextField
            label="Pedido del consumidor"
            type="textarea"
            rows={3}
            value={formData.consumerRequest}
            onInput={handleChange('consumerRequest')}
            error={!!fieldErrors.consumerRequest}
            supportingText={fieldErrors.consumerRequest}
          />
        </div>
      </Card>

      {/* ── Submit ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="filled"
          onClick={handleSubmit}
          disabled={isPending}
          style={{ minWidth: '200px' }}
        >
          <Icon slot="icon" size={21}>
            {isPending ? 'sync' : 'send'}
          </Icon>
          {isPending ? 'Enviando...' : 'Presentar reclamo'}
        </Button>
      </div>

      <AlertSnackbar
        open={feedback.open}
        description={feedback.description}
        color={feedback.color}
        onClose={() => setFeedback((prev) => ({ ...prev, open: false }))}
      />
    </div>
  );
}
