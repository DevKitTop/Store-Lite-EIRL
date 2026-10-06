'use client';

import { useState, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import type { ReactNode } from 'react';
import { WhatsAppConnectModal } from './WhatsAppConnectModal';

interface WhatsAppConnectButtonProps {
  businessId: string;
  children?: ReactNode;
  className?: string;
  onSuccess?: () => void;
}

export function WhatsAppConnectButton({
  businessId,
  children,
  className = '',
  onSuccess,
}: WhatsAppConnectButtonProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [connectData, setConnectData] = useState<{
    phoneNumberId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      const response = await fetch('/api/seller/whatsapp/connect/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al iniciar conexión');
      }

      setConnectData(data);
      setShowModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setIsConnecting(false);
    }
  }, [businessId]);

  const handleModalClose = useCallback(() => {
    setShowModal(false);
    setConnectData(null);
  }, []);

  const handleModalSuccess = useCallback(() => {
    setShowModal(false);
    setConnectData(null);
    onSuccess?.();
  }, [onSuccess]);

  // Default button content
  const defaultContent = (
    <button
      type="button"
      onClick={handleConnect}
      disabled={isConnecting || showModal}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 text-sm font-medium hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      <MessageSquare className="w-4 h-4" />
      <span>{isConnecting ? 'Conectando...' : 'Conectar WhatsApp'}</span>
    </button>
  );

  return (
    <>
      {children ?? defaultContent}
      {showModal && connectData && (
        <WhatsAppConnectModal
          phoneNumberId={connectData.phoneNumberId}
          code={connectData.code}
          expiresAt={connectData.expiresAt}
          onClose={handleModalClose}
          onSuccess={handleModalSuccess}
        />
      )}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 animate-slide-up" role="alert">
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <span className="flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-bold text-lg leading-none px-2"
              aria-label="Cerrar"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}