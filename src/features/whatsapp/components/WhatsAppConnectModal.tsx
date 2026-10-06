'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';

interface WhatsAppConnectModalProps {
  phoneNumberId: string;
  code: string;
  expiresAt: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function WhatsAppConnectModal({
  phoneNumberId,
  code,
  expiresAt,
  onClose,
  onSuccess,
}: WhatsAppConnectModalProps) {
  const [status, setStatus] = useState<'pending' | 'connected' | 'expired' | 'error'>('pending');
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Expiry time is derived purely from the expiresAt prop — safe to compute
  // in render. Time-now (Date.now) is only read inside effects/handlers to
  // satisfy the react-hooks/purity rule.
  const expiryTime = new Date(expiresAt).getTime();

  // Countdown timer. The initial time-left is computed here (not in render)
  // so Date.now() never runs during render (react-hooks/purity).
  useEffect(() => {
    const initialTimeLeft = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
    setTimeLeft(initialTimeLeft);

    if (initialTimeLeft <= 0) {
      setStatus('expired');
      return;
    }

    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiryTime - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setStatus('expired');
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [expiryTime]);

  // Polling for status. Deps intentionally exclude `timeLeft` so the poll
  // interval is NOT torn down and recreated on every 1s countdown tick
  // (which would fire ~1 status request per second while pending).
  useEffect(() => {
    if (status !== 'pending') return;

    const poll = async () => {
      try {
        const response = await fetch('/api/seller/whatsapp/connect/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumberId }),
        });

        const data = await response.json();

        if (response.ok && data.status === 'connected') {
          setStatus('connected');
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
          // Small delay to show success state
          setTimeout(() => onSuccess(), 1000);
        } else if (data.status === 'expired' || Date.now() >= expiryTime) {
          setStatus('expired');
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
        }
      } catch (err) {
        console.error('[WhatsAppConnectModal] Polling error:', err);
      }
    };

    const interval = setInterval(poll, 5000);
    pollingIntervalRef.current = interval;

    // Initial check
    poll();

    return () => {
      clearInterval(interval);
      pollingIntervalRef.current = null;
    };
  }, [phoneNumberId, status, expiryTime, onSuccess]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (status === 'connected') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
        <div className="w-full max-w-md bg-white rounded-2xl p-8 text-center animate-scale-in" onClick={(e) => e.stopPropagation()}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
            <MessageSquare className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">¡WhatsApp Conectado!</h2>
          <p className="text-gray-600">Tu número ya está vinculado y listo para usar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl p-8 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Cerrar"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {status === 'expired' ? (
          <>
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Código Expirado</h2>
            <p className="text-gray-600 mb-6">El código de vinculación ha expirado. Intenta nuevamente.</p>
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Entendido
            </button>
          </>
        ) : (
          <>
            <div className="text-center mb-6">
              <p className="text-sm text-gray-500 mb-2">Ingresa este código en WhatsApp Business</p>
              <div className="inline-flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-6 py-4">
                <span className="text-4xl font-mono font-bold text-green-700 tracking-widest">{code}</span>
              </div>
              <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Expira en <strong className="text-gray-900 font-mono">{formatTime(timeLeft)}</strong></span>
              </div>
            </div>

            <div className="space-y-3 text-sm text-gray-600">
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">1</span>
                <p>Abre <strong>WhatsApp Business</strong> en tu teléfono</p>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">2</span>
                <p>Ve a <strong>Configuración → Dispositivos vinculados</strong></p>
              </div>
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold">3</span>
                <p>Toca <strong>Vincular dispositivo</strong> e ingresa el código de arriba</p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}