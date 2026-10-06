// =====================================================
// WhatsAppCoexistenceModal.tsx
//
// Coexistence onboarding UI (replace the QR pair-code flow when Meta
// Embedded Signup envs are set). Renders the eligibility rules, launches
// FB.login via useFbEmbeddedSignup, and follows the spec state machine:
//
//   idle → connecting → pending → connected | error-retry
//   cancel → idle
//
// Slice-3 boundary: on FINISH the modal EMITS {businessId, wabaId,
// phoneNumberId} through onFinish — the parent (ChatClient, slice 4) POSTs
// /connect/complete and feeds back connectionStatus.
// =====================================================

'use client';

import { Loader2, MessageSquare } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useFbEmbeddedSignup } from '../hooks/useFbEmbeddedSignup';
import type { EmbeddedSignupFinishPayload } from '../lib/embeddedSignupEvents';

export interface WhatsAppCoexistenceModalProps {
  businessId: string;
  onClose: () => void;
  onFinish: (payload: { businessId: string; wabaId: string; phoneNumberId: string }) => void;
  /** Parent-driven terminal status (slice 4): pending | connected | failed. */
  connectionStatus?: 'pending' | 'connected' | 'failed';
}

type Phase = 'idle' | 'connecting' | 'pending' | 'error';

export function WhatsAppCoexistenceModal({
  businessId,
  onClose,
  onFinish,
  connectionStatus,
}: WhatsAppCoexistenceModalProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFinish = useCallback(
    (payload: EmbeddedSignupFinishPayload) => {
      setPhase('pending');
      // The scoped businessId comes from the session (props), never from the
      // Meta payload — mirrors the route contract (mismatch → 403).
      onFinish({ businessId, wabaId: payload.wabaId, phoneNumberId: payload.phoneNumberId });
    },
    [businessId, onFinish],
  );

  const { launch } = useFbEmbeddedSignup({
    onFinish: handleFinish,
    onError: (message) => {
      setErrorMessage(message);
      setPhase('error');
    },
    onCancel: () => setPhase('idle'),
  });

  const handleLaunch = useCallback(() => {
    setPhase('connecting');
    void launch();
  }, [launch]);

  // Parent-driven terminal states (slice 4 wires the poll).
  if (connectionStatus === 'connected') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
        onClick={onClose}
      >
        <div
          className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">¡WhatsApp Conectado!</h2>
          <p className="text-gray-600">Tu número quedó vinculado y listo para usar.</p>
        </div>
      </div>
    );
  }

  const showError = connectionStatus === 'failed' || phase === 'error';

  const isProgressing = phase === 'connecting' || phase === 'pending';
  const progressTitle = phase === 'connecting' ? 'Conectando con Meta…' : 'Vinculando tu número';
  const progressHint =
    phase === 'connecting'
      ? 'Abre la ventana emergente para continuar.'
      : 'Esto puede tomar unos minutos.';

  const renderBody = () => {
    if (showError) {
      return (
        <>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-red-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            No se pudo completar la vinculación
          </h2>
          {errorMessage && <p className="text-gray-600 mb-6">{errorMessage}</p>}
          <div className="mt-6 space-y-3">
            <button
              onClick={handleLaunch}
              className="w-full px-4 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors"
            >
              Reintentar
            </button>
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </>
      );
    }

    if (isProgressing) {
      return (
        <div className="text-center py-6">
          <Loader2 className="w-10 h-10 mx-auto mb-4 text-green-600 animate-spin" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">{progressTitle}</h2>
          <p className="text-gray-600">{progressHint}</p>
        </div>
      );
    }

    return (
      <>
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Conecta tu WhatsApp</h2>
          <p className="text-gray-600">
            Vincula el número de tu negocio con WhatsApp Business App.
          </p>
        </div>

        <div className="space-y-3 text-sm text-gray-600">
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <svg
              className="flex-shrink-0 w-5 h-5 text-green-600 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p>
              Solo <strong>WhatsApp Business App versión 2.24.17 o superior</strong>
            </p>
          </div>
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <svg
              className="flex-shrink-0 w-5 h-5 text-green-600 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p>
              El <strong>enlace de vinculación</strong> es de un solo uso
            </p>
          </div>
          <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
            <svg
              className="flex-shrink-0 w-5 h-5 text-green-600 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
            <p>
              La app debe abrirse <strong>al menos una vez cada 14 días</strong>
            </p>
          </div>
        </div>

        <button
          onClick={handleLaunch}
          className="w-full mt-6 px-4 py-2.5 bg-[#1877f2] text-white rounded-lg font-medium hover:bg-[#166fe5] transition-colors"
        >
          Continuar con Meta
        </button>
      </>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl p-8 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Cerrar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {renderBody()}
      </div>
    </div>
  );
}
