'use client';

import { Icon } from '@/shared/components/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { updateOrderStatus } from './actions';
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

interface ActionModalsProps {
  paymentId: string;
  trackingToken: string;
  orderNumber: string | null;
}

export default function ActionModals({
  paymentId,
  trackingToken,
  orderNumber: _orderNumber,
}: ActionModalsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const handleAccept = async () => {
    setLoading(true);
    try {
      const res = await updateOrderStatus(paymentId, trackingToken, 'delivered', {
        callerProof: getCallerProof(trackingToken),
      });
      if (res.success) {
        window.location.hash = ''; // Cerrar modal
        router.refresh(); // Refrescar datos del servidor
      } else if (res.reason === 'reauth_required') {
        // W3/R20: `res.reason` used to be ignored here, so a lapsed cookie only
        // produced an alert and the buyer was left on a page whose gate still
        // believed it was authenticated — every retry refused identically (R19).
        // The reload in the handoff supersedes the alert: the buyer lands on the
        // gate's own re-mint state, which explains itself.
        beginOrderReauthentication(trackingToken, () => router.refresh());
      } else {
        alert(res.error);
      }
    } catch (error) {
      alert('Error al confirmar. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const handleReport = async () => {
    if (!reportReason.trim()) {
      alert('Por favor, indica el motivo del reporte.');
      return;
    }
    setLoading(true);
    try {
      const res = await updateOrderStatus(paymentId, trackingToken, 'disputed', {
        rejectionReason: reportReason,
        callerProof: getCallerProof(trackingToken),
      });
      if (res.success) {
        window.location.hash = ''; // Cerrar modal
        router.refresh(); // Refrescar datos del servidor
      } else if (res.reason === 'reauth_required') {
        // Same recoverable refusal as `handleAccept` — see the comment there.
        beginOrderReauthentication(trackingToken, () => router.refresh());
      } else {
        alert(res.error);
      }
    } catch (error) {
      alert('Error al enviar el reporte. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* POPUP REPORTAR */}
      <div id="report-form" className="modal-overlay">
        <div className="modal-box">
          <h3 style={{ margin: '0 0 1rem 0', fontWeight: 900 }}>Reportar Observación</h3>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '1.5rem' }}>
            Indica el motivo por el cual el ticket de envío no es válido o tiene errores.
          </p>
          <textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            placeholder="Ej: El número de seguimiento no existe en la web de Olva..."
            style={{
              width: '100%',
              height: '120px',
              borderRadius: '16px',
              border: '1px solid #ccc',
              padding: '1rem',
              fontSize: '0.9rem',
              marginBottom: '1.5rem',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <a href="#" className="btn-action btn-outline" style={{ opacity: loading ? 0.5 : 1 }}>
              Cancelar
            </a>
            <button onClick={handleReport} className="btn-action btn-report" disabled={loading}>
              {loading ? 'ENVIANDO...' : 'Enviar Reporte'}
            </button>
          </div>
        </div>
      </div>

      {/* MODAL: ACCEPT CONFIRMATION */}
      <div id="accept-confirm" className="modal-overlay">
        <div className="modal-box" style={{ textAlign: 'center' }}>
          <Icon size={48} style={{ color: '#4CAF50', marginBottom: '1.5rem' }}>
            check_circle
          </Icon>
          <h3 style={{ margin: '0 0 1rem 0', fontWeight: 900 }}>¿Confirmar el Envío?</h3>
          <p style={{ fontSize: '0.85rem', opacity: 0.7, marginBottom: '2rem' }}>
            Al confirmar, el pedido pasará a <b>EN CAMINO</b> y declaras que has verificado los
            datos del courier.
          </p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <a href="#" className="btn-action btn-outline" style={{ opacity: loading ? 0.5 : 1 }}>
              Volver
            </a>
            <button onClick={handleAccept} className="btn-action btn-confirm" disabled={loading}>
              {loading ? 'CONFIRMANDO...' : 'SÍ, CONFIRMAR'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
