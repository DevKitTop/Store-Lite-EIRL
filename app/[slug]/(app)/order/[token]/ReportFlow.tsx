'use client';

import { rejectFinalization } from '@/features/dashboard/actions/finalizationActions';
import { Icon } from '@/shared/components/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import './FlowModals.css';
import { beginOrderReauthentication } from './orderReauth';

interface ReportFlowProps {
  paymentId: string;
  trackingToken: string;
}

type FlowState = 'idle' | 'loading' | 'success';

const REPORT_REASONS = [
  { value: 'NOT_RECEIVED', label: 'No recibí el producto' },
  { value: 'WRONG_PRODUCT', label: 'El producto no coincide' },
  { value: 'DAMAGED', label: 'Llegó dañado o incompleto' },
  { value: 'SELLER_UNRESPONSIVE', label: 'El vendedor no responde' },
  { value: 'OTHER', label: 'Otro motivo' },
];

export default function ReportFlow({ paymentId, trackingToken }: ReportFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>('idle');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Seleccioná un motivo.');
      return;
    }

    setState('loading');
    try {
      const result = await rejectFinalization(paymentId, trackingToken, reason);
      if (result.success) {
        setState('success');
        router.refresh();
      } else if (result.reason === 'reauth_required') {
        // R20: the same recoverable refusal `ConfirmationFlow` handles. Without
        // this branch a buyer whose cookie lapsed got the generic error and
        // stayed on a page whose gate still believed it was authenticated — so
        // `rejectFinalization` would refuse them again on every retry (R19).
        beginOrderReauthentication(trackingToken, () => router.refresh());
        setError(result.error || 'Necesitás volver a verificar tu acceso al pedido.');
        setState('idle');
      } else {
        setError(result.error || 'Error al enviar el reporte');
        setState('idle');
      }
    } catch {
      setError('Error inesperado al enviar el reporte');
      setState('idle');
    }
  };

  if (state === 'success') {
    return (
      <div id="report-finalize" className="rf-overlay rf-overlay--visible">
        <div className="rf-dialog rf-dialog--compact">
          <button
            className="rf-close"
            onClick={() => (window.location.hash = '')}
            aria-label="Cerrar"
          >
            <Icon>close</Icon>
          </button>

          <div className="rf-icon-circle rf-icon-circle--compact-shield">
            <Icon size={22}>shield</Icon>
          </div>

          <h2
            className="rf-title"
            style={{ fontSize: '1.15rem', fontWeight: 500, marginBottom: '0.5rem' }}
          >
            Reporte enviado
          </h2>

          <p className="cf-body cf-body--compact">
            Notificamos al vendedor. Vamos a revisar tu caso y te contactamos pronto.
          </p>

          <div
            className="cf-card"
            style={{
              background: 'var(--md-sys-color-secondary-container, #e8def8)',
              marginBottom: '1rem',
            }}
          >
            <p
              className="cf-card-text"
              style={{ color: 'var(--md-sys-color-on-secondary-container, #1d192b)' }}
            >
              Tu pago está protegido. No se liberará hasta resolver el problema.
            </p>
          </div>

          <button
            className="cf-btn cf-btn--primary cf-btn--compact"
            onClick={() => (window.location.hash = '')}
            style={{ margin: '0 auto' }}
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="report-finalize" className="rf-overlay">
      <div className="rf-dialog rf-dialog--compact">
        <button
          className="rf-close"
          onClick={() => (window.location.hash = '')}
          disabled={state === 'loading'}
          aria-label="Cerrar"
        >
          <Icon>close</Icon>
        </button>

        {state === 'loading' ? (
          <div className="rf-loading" style={{ padding: '1rem 0' }}>
            <div className="rf-spinner" style={{ width: 40, height: 40, marginBottom: '0.75rem' }}>
              <div className="rf-spinner__track" />
              <div className="rf-spinner__fill" />
            </div>
            <h2 className="rf-title rf-title--small" style={{ fontWeight: 500 }}>
              Enviando reporte...
            </h2>
          </div>
        ) : (
          <>
            <div className="rf-icon-circle rf-icon-circle--compact">
              <Icon size={22}>flag</Icon>
            </div>

            <h2
              className="rf-title"
              style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '0.25rem' }}
            >
              Reportar problema
            </h2>

            <p className="cf-question--compact">Decinos qué pasó con tu pedido</p>

            <form onSubmit={handleSubmit} className="rf-form" style={{ gap: '0.75rem' }}>
              <div className="rf-field">
                <label htmlFor="report-reason-compact" className="rf-label">
                  Motivo
                </label>
                <select
                  id="report-reason-compact"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.75rem 0.875rem',
                    borderRadius: '14px',
                    border: '1.5px solid var(--md-sys-color-outline-variant)',
                    background: 'var(--md-sys-color-surface)',
                    fontSize: '0.85rem',
                    color: 'var(--md-sys-color-on-surface)',
                    fontFamily: 'inherit',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">Seleccioná un motivo...</option>
                  {REPORT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <div className="rf-error" style={{ fontSize: '0.75rem' }}>
                  <Icon size={16}>error</Icon>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="cf-btn cf-btn--secondary cf-btn--compact"
                disabled={!reason}
                style={{ margin: '0 auto' }}
              >
                <Icon size={16}>send</Icon>
                Enviar
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
