'use client';

import { confirmFinalization } from '@/features/dashboard/actions/finalizationActions';
import { Icon } from '@/shared/components/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import './FlowModals.css';
import { beginOrderReauthentication } from './orderReauth';

interface ConfirmationFlowProps {
  paymentId: string;
  trackingToken: string;
  businessName: string;
}

type FlowState = 'idle' | 'loading' | 'success';

export default function ConfirmationFlow({
  paymentId,
  trackingToken,
  businessName,
}: ConfirmationFlowProps) {
  const router = useRouter();
  const [state, setState] = useState<FlowState>('idle');
  const [error, setError] = useState<string | null>(null);

  const closeModal = () => {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  };

  const handleConfirm = async () => {
    setState('loading');
    try {
      const result = await confirmFinalization(paymentId, trackingToken);
      if (result.success) {
        setState('success');
        router.refresh();
      } else if (result.reason === 'reauth_required') {
        // R20: the signed cookie lapsed mid-confirmation (1h TTL). This branch is
        // RECOVERABLE, so the stale client session has to go and the page has to be
        // reloaded for `OrderAuthGate` to re-check. Both live in `orderReauth`
        // because `refresh` alone cannot do it — see the comment there for why the
        // gate's effect never re-runs on an in-place refresh.
        beginOrderReauthentication(trackingToken, () => router.refresh());
        setError(result.error || 'Necesitás volver a verificar tu acceso al pedido.');
        setState('idle');
      } else {
        setError(result.error || 'Error al confirmar');
        setState('idle');
      }
    } catch {
      setError('Error inesperado al confirmar');
      setState('idle');
    }
  };

  if (state === 'success') {
    return (
      <div id="confirm-finalize" className="cf-overlay cf-overlay--visible">
        <div className="cf-dialog">
          <button className="cf-close" onClick={closeModal} aria-label="Cerrar">
            <Icon>close</Icon>
          </button>

          <div className="cf-icon-circle cf-icon-circle--success-small">
            <Icon size={28}>check_circle</Icon>
          </div>

          <h2 className="cf-title--success">Confirmado</h2>

          <p className="cf-body cf-body--compact">
            Tu pedido fue registrado como entregado. El pago ya fue liberado al vendedor.
          </p>

          <div
            className="cf-card"
            style={{ background: 'var(--md-sys-color-secondary-container, #e8def8)' }}
          >
            <p
              className="cf-card-text"
              style={{ color: 'var(--md-sys-color-on-secondary-container, #1d192b)' }}
            >
              Gracias por confiar en {businessName}. Tu compra está protegida de principio a fin.
            </p>
          </div>

          <button
            className="cf-btn cf-btn--primary"
            onClick={closeModal}
            style={{ marginTop: '0.75rem' }}
          >
            CERRAR
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div id="confirm-finalize" className="cf-overlay">
        <div className="cf-dialog">
          {/* Close button */}
          <button
            className="cf-close"
            onClick={closeModal}
            disabled={state === 'loading'}
            aria-label="Cerrar"
          >
            <Icon>close</Icon>
          </button>

          {state === 'loading' ? (
            /* ─── LOADING STATE ─── */
            <div className="cf-loading">
              <div className="cf-spinner">
                <div className="cf-spinner__track" />
                <div className="cf-spinner__fill" />
              </div>
              <h2 className="cf-title cf-title--small">Confirmando tu pedido...</h2>
              <p className="cf-subtitle">Procesando la confirmación de entrega</p>
            </div>
          ) : (
            /* ─── IDLE STATE ─── */
            <>
              <h2
                className="cf-title"
                style={{ fontSize: '1.35rem', marginBottom: '0.5rem', fontWeight: 500 }}
              >
                Confirmar recepción
              </h2>

              <p
                className="cf-question"
                style={{ fontWeight: 400, fontSize: '0.9rem', marginBottom: '1rem' }}
              >
                ¿Recibiste el producto y todo está en orden?
              </p>

              <div className="cf-card" style={{ textAlign: 'left' }}>
                <p className="cf-card-text">
                  Al confirmar, el pedido se marca como Finalizado y el vendedor recibe su pago.
                  Esta acción no se puede revertir.
                </p>
              </div>

              <div className="cf-actions" style={{ marginTop: '0.25rem' }}>
                <button className="cf-btn cf-btn--primary" onClick={handleConfirm}>
                  <Icon size={20}>check_circle</Icon>
                  Sí, todo correcto
                </button>
                <a href="#report-finalize" className="cf-btn cf-btn--secondary">
                  <Icon size={18}>flag</Icon>
                  No, tengo un problema
                </a>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── ERROR SNACKBAR ─── */}
      {error && (
        <div className="cf-snackbar">
          <Icon size={20}>error</Icon>
          <span>{error}</span>
          <button className="cf-snackbar-close" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
