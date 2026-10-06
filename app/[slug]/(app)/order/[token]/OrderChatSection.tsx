'use client';

import { fetchMessages, sendMessage } from '@/features/chat/actions/chatActions';
import { createClient } from '@/lib/supabase/client';
import { Icon } from '@/shared/components/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { syncChatSession } from './actions';

interface Message {
  id: string;
  text: string;
  isFromStore: boolean;
  createdAt: Date;
}

interface OrderChatSectionProps {
  businessName: string;
  businessId: string;
  paymentId: string;
  buyerEmail: string;
  buyerName: string | null;
  buyerDni: string;
  trackingToken: string;
}

export default function OrderChatSection({
  businessName,
  businessId,
  paymentId,
  buyerEmail,
  buyerName,
  buyerDni,
  trackingToken,
}: OrderChatSectionProps) {
  const supabase = useMemo(() => createClient(), []);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // IDs confirmados por server response — Realtime los saltea para evitar duplicados
  const confirmedIdsRef = useRef<Set<string>>(new Set());

  // Sincronización de Identidad y Sesión
  useEffect(() => {
    const initChat = async () => {
      try {
        setIsLoading(true);
        const guestIdFromStorage = localStorage.getItem('chat_guest_id');
        const name = buyerName || buyerEmail.split('@')[0];

        const res = await syncChatSession({
          guestIdFromStorage,
          dni: buyerDni,
          businessId,
          buyerName: name,
          paymentId,
        });

        if (res.success && res.sessionId) {
          setSessionId(res.sessionId);
          setGuestId(res.guestId!);
          localStorage.setItem('chat_guest_id', res.guestId!);
        }
      } catch (err) {
        console.error('[OrderChat] Sync failed:', err);
      } finally {
        setTimeout(() => setIsLoading(false), 500);
      }
    };
    initChat();
  }, [businessId, paymentId, buyerDni, buyerEmail, buyerName]);

  // Carga inicial de mensajes
  useEffect(() => {
    if (!sessionId || !guestId) return;

    const loadMessages = async () => {
      try {
        const result = await fetchMessages(sessionId, guestId);
        if (result.success && result.messages) {
          setMessages(
            result.messages.map((m) => ({
              id: m.id,
              text: m.content,
              isFromStore: !!m.isFromStore,
              createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            })),
          );
        }
      } catch (err) {
        console.error('[OrderChat] Error loading messages:', err);
      }
    };
    loadMessages();
  }, [sessionId, guestId]);

  // ─── Real-time subscription + polling fallback ─────────────────────
  // Igual que ChatClient: Realtime es el "fast path", polling es safety net.
  useEffect(() => {
    if (!sessionId || !guestId) return;

    // ── Realtime subscription (scoped server-side a esta sesión) ──
    const channel = supabase
      .channel(`order-chat-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload: any) => {
          const m = payload.new;
          // Client-side filter (defense-in-depth): solo mensajes de esta sesión Y este payment
          if (String(m.session_id) !== sessionId) return;
          if (String(m.payment_id) !== paymentId) return;

          // Saltar mensajes ya confirmados por server response (evitar duplicados)
          if (confirmedIdsRef.current.has(m.id)) return;

          setMessages((prev) => {
            if (prev.find((item) => item.id === m.id)) return prev;
            return [
              ...prev,
              {
                id: m.id,
                text: m.content,
                isFromStore: !!m.is_from_store,
                createdAt: m.created_at ? new Date(m.created_at) : new Date(),
              },
            ];
          });
        },
      )
      .subscribe();

    // ── Polling fallback cada 5s (igual que ChatClient) ──
    const pollMessages = async () => {
      try {
        const result = await fetchMessages(sessionId, guestId);
        if (!result.success || !result.messages) return;

        setMessages((prev) => {
          const mapped = result.messages!.map((m) => ({
            id: m.id,
            text: m.content,
            isFromStore: !!m.isFromStore,
            createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
          }));

          // Merge: deduplicar por id, mantener mensajes temporales
          const pendingTemps = prev.filter(
            (m) =>
              m.id.startsWith('temp-') &&
              !mapped.some(
                (db) =>
                  db.text === m.text &&
                  Math.abs(db.createdAt.getTime() - m.createdAt.getTime()) < 5000,
              ),
          );

          const merged = [...mapped, ...pendingTemps];
          const seen = new Set<string>();
          const deduped = merged.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          deduped.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

          // Evitar re-renders si no hubo cambios
          if (
            deduped.length === prev.length &&
            deduped.every((m, i) => m.id === prev[i].id && m.text === prev[i].text)
          ) {
            return prev;
          }
          return deduped;
        });
      } catch {
        // Silencioso — el polling no debe mostrar errores
      }
    };

    const intervalId = setInterval(pollMessages, 5000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(intervalId);
    };
  }, [sessionId, guestId, supabase]);

  // ─── WhatsApp-style date helpers ────────────────────────────────────
  function padTwo(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
  }

  function isSameDay(a: Date, b: Date): boolean {
    if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function daysBetween(from: Date, to: Date): number {
    const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const t = new Date(to.getFullYear(), to.getMonth(), to.getDate());
    return Math.round((t.getTime() - f.getTime()) / 86400000);
  }

  function formatDateLabel(date: Date): string {
    if (isNaN(date.getTime())) return '';

    const now = new Date();
    const diff = daysBetween(date, now);

    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Ayer';

    if (diff < 7) {
      const dayNames = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
      return dayNames[date.getDay()];
    }

    if (date.getFullYear() === now.getFullYear()) {
      return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)}`;
    }

    return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = newMessage.trim();
    if (!text || !sessionId || !guestId || isSending) return;

    // Optimistic UI: agregar mensaje inmediatamente al estado local
    const optimisticId = `temp-${Date.now()}`;
    const now = new Date();
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, text, isFromStore: false, createdAt: now },
    ]);

    setIsSending(true);
    setNewMessage('');

    try {
      const result = await sendMessage({ sessionId, guestId, paymentId, content: text });

      // Si el servidor responde con éxito, reemplazamos el mensaje temporal
      // con el real (el realtime de Supabase también lo hará, pero esto es fallback)
      if (result.success && result.message) {
        const realId = result.message.id;
        confirmedIdsRef.current.add(realId);
        setTimeout(() => confirmedIdsRef.current.delete(realId), 2000);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticId
              ? {
                  ...m,
                  id: realId,
                  createdAt: result.message!.createdAt ? new Date(result.message!.createdAt) : now,
                }
              : m,
          ),
        );
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setNewMessage(text);
        console.error('[OrderChat] Send failed:', result.error);
      }
    } catch (err) {
      // Si falla, quitamos el mensaje optimista y restauramos el input
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setNewMessage(text);
      console.error('[OrderChat] Send failed:', err);
    } finally {
      setIsSending(false);
    }
  }, [newMessage, sessionId, guestId, isSending]);

  if (isLoading) {
    return (
      <div className="chat-loading">
        <style
          dangerouslySetInnerHTML={{
            __html: `
          .chat-loading { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: var(--md-sys-color-surface-container); border-radius: 32px; gap: 1rem; }
          .chat-spinner { width: 30px; height: 30px; border: 3px solid var(--md-sys-color-primary-container); border-top-color: var(--md-sys-color-primary); border-radius: 50%; animation: c-spin 0.8s linear infinite; }
          @keyframes c-spin { to { transform: rotate(360deg); } }
        `,
          }}
        />
        <div className="chat-spinner" />
        <p style={{ fontSize: '0.75rem', fontWeight: 900, opacity: 0.5 }}>
          SINCRONIZANDO MENSAJES...
        </p>
      </div>
    );
  }

  return (
    <div className="chat-wrapper">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .chat-wrapper { height: 100%; display: flex; flex-direction: column; background: var(--md-sys-color-surface-container-low); border-radius: 40px; border: 1px solid var(--md-sys-color-outline-variant); overflow: hidden; box-shadow: var(--md-sys-elevation-level1); }
        .chat-header { padding: 1.5rem; background: var(--md-sys-color-surface-container-high); border-bottom: 1px solid var(--md-sys-color-outline-variant); display: flex; align-items: center; gap: 1rem; }
        .chat-body { flex: 1; padding: 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; background: var(--md-sys-color-surface-container-low); }
        .msg-bubble { padding: 1rem 1.25rem; border-radius: 24px; font-size: 0.95rem; max-width: 85%; line-height: 1.5; position: relative; }
        .msg-store { background: var(--md-sys-color-surface-container-highest); color: var(--md-sys-color-on-surface); align-self: flex-start; border-bottom-left-radius: 4px; }
        .msg-user { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); align-self: flex-end; border-bottom-right-radius: 4px; box-shadow: 0 4px 12px rgba(var(--md-sys-color-primary-rgb), 0.2); }
        .msg-time { display: block; font-size: 10px; margin-top: 4px; opacity: 0.5; font-weight: 700; }
        .msg-user .msg-time { color: var(--md-sys-color-on-primary); opacity: 0.7; }
        .chat-footer { padding: 1.25rem; background: var(--md-sys-color-surface-container-high); border-top: 1px solid var(--md-sys-color-outline-variant); }
        .input-bar { background: var(--md-sys-color-surface); border-radius: 100px; border: 2px solid var(--md-sys-color-outline-variant); display: flex; align-items: center; padding: 6px 6px 6px 1.5rem; gap: 0.5rem; transition: all 0.3s ease; }
        .input-bar:focus-within { border-color: var(--md-sys-color-primary); box-shadow: 0 0 0 4px rgba(var(--md-sys-color-primary-rgb), 0.1); }
        .input-bar input { flex: 1; border: none; background: transparent; outline: none; font-size: 0.95rem; height: 40px; color: var(--md-sys-color-on-surface); }
        .send-btn { width: 44px; height: 44px; border-radius: 50%; background: var(--md-sys-color-primary); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
        .send-btn:hover { transform: scale(1.05); box-shadow: 0 5px 15px rgba(var(--md-sys-color-primary-rgb), 0.3); }
        .send-btn:disabled { opacity: 0.5; transform: none; }
      `,
        }}
      />

      <div className="chat-header">
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '16px',
            background: 'var(--md-sys-color-tertiary-container)',
            color: 'var(--md-sys-color-on-tertiary-container)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon size={28}>support_agent</Icon>
        </div>
        <div>
          <p style={{ margin: 0, fontWeight: 950, fontSize: '1rem', letterSpacing: '-0.02em' }}>
            Soporte de Tienda
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#4CAF50' }} />
            <span
              style={{
                fontSize: '11px',
                fontWeight: 900,
                color: '#4CAF50',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Conectado
            </span>
          </div>
        </div>
      </div>

      <div className="chat-body">
        {messages.length === 0 ? (
          <div style={{ margin: 'auto', textAlign: 'center', opacity: 0.3 }}>
            <div
              style={{
                background: 'var(--md-sys-color-surface-container-highest)',
                width: 80,
                height: 80,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1.5rem',
              }}
            >
              <Icon size={40}>forum</Icon>
            </div>
            <p style={{ fontSize: '0.85rem', fontWeight: 950, letterSpacing: '0.1em' }}>
              CHATEÁ CON EL VENDEDOR
            </p>
          </div>
        ) : (
          messages.map((m, index) => {
            const showDateSeparator =
              index === 0 || !isSameDay(messages[index - 1].createdAt, m.createdAt);

            return (
              <React.Fragment key={m.id}>
                {showDateSeparator && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      margin: '1rem 0',
                    }}
                  >
                    <span
                      style={{
                        background: 'var(--md-sys-color-surface-container-high, rgba(0,0,0,0.04))',
                        padding: '4px 16px',
                        borderRadius: '100px',
                        fontSize: '0.7rem',
                        fontWeight: 900,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: 'var(--md-sys-color-on-surface-variant, #666)',
                      }}
                    >
                      {formatDateLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <div className={`msg-bubble ${m.isFromStore ? 'msg-store' : 'msg-user'}`}>
                  {m.text}
                  <span
                    className="msg-time"
                    style={{ textAlign: m.isFromStore ? 'left' : 'right' }}
                  >
                    {m.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </React.Fragment>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-footer">
        <div className="input-bar">
          <input
            type="text"
            placeholder="Escribí un mensaje..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isSending}
          />
          <button
            className="send-btn"
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
          >
            <Icon size={24}>{isSending ? 'hourglass_top' : 'send'}</Icon>
          </button>
        </div>
      </div>
    </div>
  );
}
