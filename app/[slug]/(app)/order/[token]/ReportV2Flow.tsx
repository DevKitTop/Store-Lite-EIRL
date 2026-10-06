'use client';

import { Icon } from '@/shared/components/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { reportIssueV2 } from './actions';
import './FlowModals.css';
import { beginOrderReauthentication } from './orderReauth';
import type { CallerProof } from './types';

function getCallerProof(token: string): CallerProof | undefined {
  try {
    const raw = localStorage.getItem(`order_session_${token}`);
    if (!raw) return undefined;
    const session = JSON.parse(raw);
    const proof: CallerProof = {};
    if (typeof session.dni === 'string') proof.dni = session.dni;
    if (typeof session.authId === 'string') proof.authId = session.authId;
    return proof.dni || proof.authId ? proof : undefined;
  } catch {
    return undefined;
  }
}

interface ReportV2FlowProps {
  paymentId: string;
  trackingToken: string;
}

type FlowState = 'warning' | 'form' | 'loading' | 'success';

const ISSUE_REASONS = [
  { value: 'INVALID_TRACKING', label: 'El número de tracking no funciona' },
  { value: 'INCORRECT_COST', label: 'El costo de envío es incorrecto' },
  { value: 'MISSING_INFORMATION', label: 'Falta información del envío' },
  { value: 'WRONG_DOCUMENT', label: 'El comprobante no corresponde a mi pedido' },
  { value: 'SHIPPING_COST_DISAGREEMENT', label: 'No acordé el costo de envío' },
  { value: 'OTHER', label: 'Otro motivo' },
];

export default function ReportV2Flow({ paymentId, trackingToken }: ReportV2FlowProps) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>('warning');
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
      const result = await reportIssueV2(
        paymentId,
        trackingToken,
        reason,
        getCallerProof(trackingToken),
      );
      if (result.success) {
        setState('success');
        router.refresh();
      } else if (result.reason === 'reauth_required') {
        // W3/R20: `res.reason` used to be ignored here, so a lapsed cookie only
        // showed an error inside a form that could never succeed again. The
        // handoff drops the stale marker and reloads, which hands the buyer back
        // to `OrderAuthGate` to re-mint.
        beginOrderReauthentication(trackingToken, () => router.refresh());
        setError(result.error || 'Necesitás volver a verificar tu acceso al pedido.');
        setState('form');
      } else {
        setError(result.error || 'Error al enviar el reporte');
        setState('form');
      }
    } catch {
      setError('Error inesperado al enviar el reporte');
      setState('form');
    }
  };

  if (state === 'success') {
    return (
      <div id="report-v2" className="cf-overlay cf-overlay--visible">
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
    <div id="report-v2" className="cf-overlay">
      <div className="rf-dialog rf-dialog--compact">
        <button
          className="rf-close"
          onClick={() => {
            setState('warning');
            setError(null);
            window.location.hash = '';
          }}
          disabled={state === 'loading'}
          aria-label="Cerrar"
        >
          <Icon>close</Icon>
        </button>

        {(() => {
          if (state === 'loading') {
            return (
              <div className="rf-loading" style={{ padding: '1rem 0' }}>
                <div
                  className="rf-spinner"
                  style={{ width: 40, height: 40, marginBottom: '0.75rem' }}
                >
                  <div className="rf-spinner__track" />
                  <div className="rf-spinner__fill" />
                </div>
                <h2 className="rf-title rf-title--small" style={{ fontWeight: 500 }}>
                  Enviando reporte...
                </h2>
              </div>
            );
          }

          if (state === 'warning') {
            return (
              <>
                <div className="rf-icon-circle rf-icon-circle--compact">
                  <Icon size={22}>warning</Icon>
                </div>

                <h2
                  className="rf-title"
                  style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '0.25rem' }}
                >
                  ¿Reportar un problema?
                </h2>

                <p className="cf-question--compact">
                  Abrir un reporte puede retrasar el envío. Intentá resolverlo con el negocio antes.
                </p>

                <div className="cf-actions" style={{ marginTop: '0.5rem' }}>
                  <a
                    href="#"
                    className="cf-btn cf-btn--secondary cf-btn--compact"
                    onClick={(e) => {
                      e.preventDefault();
                      setState('form');
                    }}
                  >
                    <Icon size={16}>flag</Icon>
                    Abrir reporte
                  </a>
                  <a
                    href="#"
                    className="cf-btn cf-btn--compact"
                    onClick={() => (window.location.hash = '')}
                    style={{
                      background: 'transparent',
                      color: 'var(--md-sys-color-on-surface-variant)',
                      fontWeight: 400,
                      fontSize: '0.8rem',
                      textTransform: 'none',
                      letterSpacing: '0',
                    }}
                  >
                    Cancelar
                  </a>
                </div>
              </>
            );
          }

          return (
            <>
              <div className="rf-icon-circle rf-icon-circle--compact">
                <Icon size={22}>report_problem</Icon>
              </div>

              <h2
                className="rf-title"
                style={{ fontSize: '1.1rem', fontWeight: 500, marginBottom: '0.25rem' }}
              >
                Reportar problema
              </h2>

              <p className="cf-question--compact">Seleccioná el motivo del reporte</p>

              <form onSubmit={handleSubmit} className="rf-form" style={{ gap: '0.75rem' }}>
                <div className="rf-field">
                  <label htmlFor="issue-reason-compact" className="rf-label">
                    Motivo
                  </label>
                  <select
                    id="issue-reason-compact"
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
                    {ISSUE_REASONS.map((r) => (
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

                <div className="cf-actions" style={{ marginTop: '0.25rem', gap: '0.5rem' }}>
                  <button
                    type="submit"
                    className="cf-btn cf-btn--secondary cf-btn--compact"
                    disabled={!reason}
                    style={{ margin: '0 auto' }}
                  >
                    <Icon size={16}>send</Icon>
                    Enviar
                  </button>
                  <a
                    href="#"
                    className="cf-btn cf-btn--compact"
                    onClick={(e) => {
                      e.preventDefault();
                      setState('warning');
                      setError(null);
                    }}
                    style={{
                      background: 'transparent',
                      color: 'var(--md-sys-color-on-surface-variant)',
                      fontWeight: 400,
                      fontSize: '0.8rem',
                      textTransform: 'none',
                      letterSpacing: '0',
                    }}
                  >
                    Volver
                  </a>
                </div>
              </form>
            </>
          );
        })()}
      </div>
    </div>
  );
}
