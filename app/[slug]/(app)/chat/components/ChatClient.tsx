'use client';

import { WhatsAppConnectModal } from '@/features/whatsapp/components/WhatsAppConnectModal';
import { WhatsAppTemplateManager } from '@/features/whatsapp/components/WhatsAppTemplateManager';
import { createClient } from '@/lib/supabase/client';
import { AlertSnackbar } from '@/shared/components/ui/feedback/AlertSnackbar';
import type { RealtimePostgresInsertPayload } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteChatSession,
  fetchChatSessions,
  fetchMessages,
  sendMessage,
} from '../actions/chatActions';
import {
  fetchWhatsAppConversations,
  fetchWhatsAppMessages,
  sendWhatsAppMessage,
} from '../actions/whatsappActions';
import styles from '../messages.module.css';
import { ChatSidebar } from './ChatSidebar';
import { ChatWindow } from './ChatWindow';
import { DeleteChatDialog } from './DeleteChatDialog';
import { resolveChannelId } from './chatChannel';

const DEBUG_ABORTS = process.env.NEXT_PUBLIC_DEBUG_ABORTS === '1';

const MS_IN_DAY = 86400000;
const DAY_NAMES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

// ─── localStorage helpers ────────────────────────────────────────────
const LS_PINNED = 'chat_pinned_ids';
const LS_ORDER = 'chat_order_ids';

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded — silence
  }
}
// ─────────────────────────────────────────────────────────────────────

function padTwo(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatMessageTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  // Today: show time
  if (diff < MS_IN_DAY && now.getDate() === date.getDate()) {
    return `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}`;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()
  ) {
    return 'Ayer';
  }

  // This week: show day name (short)
  const diffDays = Math.floor(diff / MS_IN_DAY);
  if (diffDays < 7) {
    return DAY_NAMES[date.getDay()];
  }

  // This year: show DD/MM
  if (date.getFullYear() === now.getFullYear()) {
    return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)}`;
  }

  // Older: show DD/MM/YY
  return `${padTwo(date.getDate())}/${padTwo(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)}`;
}

function chatDebug(message: string, payload?: Record<string, unknown>) {
  if (!DEBUG_ABORTS) return;
  console.warn('[ChatClientDebug]', message, payload ?? {});
}

export interface Chat {
  id: string;
  name: string;
  preview: string;
  time: string;
  lastMessageAt: string; // ISO timestamp for sorting by recency
  unread: number;
  avatarUrl: string;
  status?: string;
  email?: string;
  isGoogleAuth?: boolean;
  isOrderChat?: boolean;
  orderNumber?: string;
  // WhatsApp fields
  source?: 'store_lite' | 'whatsapp';
  channelId?: string;
  conversationId?: string;
}

export interface Message {
  id: string;
  text: string;
  sender: 'me' | 'them';
  time: string;
  chatId: string;
  imageUrl?: string;
  createdAt: string;
}

interface ChatClientProps {
  slug: string;
  storeName: string;
  storeDescription: string;
  storeLogo: string;
  businessId: string;
  canRespond: boolean;
  canManage: boolean;
}

export function ChatClient({
  slug,
  storeName,
  storeDescription,
  storeLogo,
  businessId,
  canRespond,
  canManage,
}: ChatClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const [sessions, setSessions] = useState<Chat[]>([]);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const selectedSessionRef = useRef<any>(null);
  const [messagesByChatId, setMessagesByChatId] = useState<Record<string, Message[]>>({});
  const loadedChatsRef = useRef<Set<string>>(new Set());
  // Tracks message IDs we've already confirmed via server response,
  // so the Realtime handler can skip them and avoid duplicates.
  const confirmedIdsRef = useRef<Set<string>>(new Set());
  // Tracks whether sessions polling has completed at least one cycle,
  // so subsequent polls can detect "new" messages and increment unread.
  const sessionsPolledRef = useRef(false);
  const messages = selectedSession ? (messagesByChatId[selectedSession.id] ?? []) : [];
  const [isSessionsLoading, setIsSessionsLoading] = useState(true);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning' | 'primary' | 'secondary' | 'tertiary';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const [isShareConfirmed, setIsShareConfirmed] = useState(false);
  const [filterTab, setFilterTab] = useState<'all' | 'unread' | 'orders' | 'whatsapp'>('all');

  // WhatsApp state
  const [whatsappChannelConnected, setWhatsAppChannelConnected] = useState(true);
  const [whatsappChannelId, setWhatsAppChannelId] = useState<string | null>(null);
  const [showWhatsAppConnectModal, setShowWhatsAppConnectModal] = useState(false);
  const [whatsAppConnectData, setWhatsAppConnectData] = useState<{
    phoneNumberId: string;
    code: string;
    expiresAt: string;
  } | null>(null);
  const [isTemplateManagerOpen, setIsTemplateManagerOpen] = useState(false);

  // ─── Pin / Reorder state (localStorage-backed) ─────────────────────
  const [isPinning, setIsPinning] = useState(false);
  // Initialize as empty to avoid SSR hydration mismatch (localStorage is client-only).
  const [pinnedChatIds, setPinnedChatIds] = useState<string[]>([]);
  const [chatOrderIds, setChatOrderIds] = useState<string[]>([]);

  // ─── Load from localStorage after hydration ────────────────────────
  useEffect(() => {
    setPinnedChatIds(loadJSON(LS_PINNED, []));
    setChatOrderIds(loadJSON(LS_ORDER, []));
  }, []);

  // ─── Initialize order from sessions on first load ──────────────────
  useEffect(() => {
    if (sessions.length > 0) {
      setChatOrderIds((prev) => {
        // If localStorage already loaded data (via the hydration effect above),
        // prev will have it — don't override.
        if (prev.length > 0) return prev;
        const ids = sessions.map((s) => s.id);
        saveJSON(LS_ORDER, ids);
        return ids;
      });
    }
  }, [sessions]);

  // ─── Sync new session IDs into order (Realtime inserts) ────────────
  useEffect(() => {
    setChatOrderIds((prev) => {
      const currentSet = new Set(prev);
      const missing = sessions.map((s) => s.id).filter((id) => !currentSet.has(id));
      if (missing.length === 0) return prev;
      const updated = [...missing, ...prev];
      saveJSON(LS_ORDER, updated);
      return updated;
    });
  }, [sessions]);

  useEffect(() => {
    selectedSessionRef.current = selectedSession;
    chatDebug('selectedSession:update', { selectedSessionId: selectedSession?.id ?? null });
  }, [selectedSession]);

  // Load chat sessions (store_lite or whatsapp based on filterTab)
  useEffect(() => {
    async function loadSessions() {
      setIsSessionsLoading(true);
      setError(null);
      try {
        if (filterTab === 'whatsapp') {
          // Load WhatsApp conversations
          const result = await fetchWhatsAppConversations(businessId);
          if (result.success) {
            setWhatsAppChannelConnected(result.channelConnected ?? true);
            const resolvedChannelId = resolveChannelId(result);
            if (resolvedChannelId) setWhatsAppChannelId(resolvedChannelId);
            if (!result.channelConnected) {
              setSessions([]);
            } else if (result.conversations) {
              const mappedChats: Chat[] = result.conversations.map((c) => {
                const lastMsg = c.lastMessage;
                const preview = lastMsg
                  ? `${lastMsg.direction === 'outbound' ? 'Tú: ' : ''}${lastMsg.body ?? ''}`
                  : 'Conversación iniciada';
                const time = lastMsg?.createdAt
                  ? formatMessageTime(new Date(lastMsg.createdAt))
                  : c.lastMessageAt
                    ? formatMessageTime(new Date(c.lastMessageAt))
                    : '';
                return {
                  id: c.id,
                  name: c.customerName || c.customerPhone || 'Cliente WhatsApp',
                  preview,
                  time,
                  lastMessageAt: lastMsg?.createdAt
                    ? new Date(lastMsg.createdAt).toISOString()
                    : c.lastMessageAt
                      ? new Date(c.lastMessageAt).toISOString()
                      : new Date().toISOString(),
                  unread: 0,
                  avatarUrl: '',
                  status: c.status ?? 'active',
                  source: 'whatsapp' as const,
                  channelId: c.channelId,
                  conversationId: c.id,
                };
              });
              setSessions(mappedChats);
            }
          } else {
            setError(result.error || 'Error al cargar conversaciones de WhatsApp');
            setWhatsAppChannelConnected(false);
          }
        } else {
          // Load store_lite chat sessions
          const result = await fetchChatSessions(businessId);
          if (result.success && result.sessions) {
            const mappedChats: Chat[] = result.sessions.map((s) => {
              const lastMessage = s.messages?.[0] ?? null;
              const preview = lastMessage
                ? `${lastMessage.isFromStore ? 'Tú: ' : ''}${lastMessage.content}`
                : 'Chat iniciado';
              const time = lastMessage?.createdAt
                ? formatMessageTime(new Date(lastMessage.createdAt))
                : s.createdAt
                  ? formatMessageTime(new Date(s.createdAt))
                  : '';
              return {
                id: s.id,
                name: s.guestName || 'Invitado',
                preview,
                time,
                lastMessageAt: lastMessage?.createdAt
                  ? new Date(lastMessage.createdAt).toISOString()
                  : s.createdAt
                    ? new Date(s.createdAt).toISOString()
                    : new Date().toISOString(),
                unread: 0,
                avatarUrl: s.guestAvatarUrl || '',
                status: s.status ?? 'active',
                email: s.guestEmail || undefined,
                isGoogleAuth: !!s.authUserId,
                isOrderChat: !!s.paymentId,
                orderNumber: s.payment?.orderNumber || undefined,
                source: 'store_lite' as const,
              };
            });
            setSessions(mappedChats);
            setWhatsAppChannelConnected(true);
          } else {
            setError(result.error || 'Error al cargar sesiones');
          }
        }
      } catch (err) {
        setError('Error inesperado al cargar sesiones');
      } finally {
        setIsSessionsLoading(false);
      }
    }

    loadSessions();
  }, [businessId, filterTab]);

  // Load messages when selection changes (with local cache)
  useEffect(() => {
    if (!selectedSession) return;

    const chatId = selectedSession.id;
    const isWhatsApp = selectedSession.source === 'whatsapp';

    // Cache hit — skip fetch
    if (loadedChatsRef.current.has(chatId)) {
      setIsMessagesLoading(false);
      return;
    }

    setIsMessagesLoading(true);

    const loadMessages = async () => {
      try {
        if (isWhatsApp) {
          const result = await fetchWhatsAppMessages(selectedSession.conversationId!);
          if (result.success && result.messages) {
            const mappedMessages: Message[] = result.messages.map((m) => ({
              id: String(m.id),
              text: m.body ?? '',
              sender: m.direction === 'outbound' ? 'me' : 'them',
              time: m.createdAt
                ? `${padTwo(new Date(m.createdAt).getHours())}:${padTwo(new Date(m.createdAt).getMinutes())}`
                : '',
              chatId: chatId,
              createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
            }));
            loadedChatsRef.current.add(chatId);
            setMessagesByChatId((prev) => ({ ...prev, [chatId]: mappedMessages }));
          } else {
            console.error('Error loading WhatsApp messages:', result.error);
            loadedChatsRef.current.add(chatId);
            setMessagesByChatId((prev) => ({ ...prev, [chatId]: [] }));
          }
        } else {
          const result = await fetchMessages(chatId);
          if (result.success && result.messages) {
            const mappedMessages: Message[] = result.messages.map((m) => ({
              id: String(m.id),
              text: m.content || '',
              sender: m.isFromStore ? 'me' : 'them',
              time: m.createdAt
                ? `${padTwo(new Date(m.createdAt).getHours())}:${padTwo(new Date(m.createdAt).getMinutes())}`
                : '',
              chatId: String(m.sessionId),
              createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
            }));
            loadedChatsRef.current.add(chatId);
            setMessagesByChatId((prev) => ({ ...prev, [chatId]: mappedMessages }));
          } else {
            console.error('Error loading messages:', result.error);
            loadedChatsRef.current.add(chatId);
            setMessagesByChatId((prev) => ({ ...prev, [chatId]: [] }));
          }
        }
      } catch (err) {
        console.error('Error loading messages:', err);
        loadedChatsRef.current.add(chatId);
        setMessagesByChatId((prev) => ({ ...prev, [chatId]: [] }));
      } finally {
        setIsMessagesLoading(false);
      }
    };
    loadMessages();
  }, [selectedSession]);

  // Real-time subscription for sessions and messages
  useEffect(() => {
    chatDebug('subscriptions:start', { businessId });

    // Get active WhatsApp channel for this business
    let whatsappChannelId: string | null = null;
    const fetchWhatsAppChannel = async () => {
      const result = await fetchWhatsAppConversations(businessId);
      if (result.channelConnected) {
        whatsappChannelId = resolveChannelId(result);
        setWhatsAppChannelId(whatsappChannelId);
      }
    };
    fetchWhatsAppChannel();

    // Subscribe to new chat sessions for this business
    const sessionChannel = supabase
      .channel('public:chat_sessions_owner')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_sessions',
          filter: `business_id=eq.${businessId}`,
        },
        (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
          const newSession = payload.new;
          chatDebug('sessionChannel:insert', { sessionId: String(newSession.id) });
          const now = new Date();
          const newChat: Chat = {
            id: String(newSession.id),
            name: (newSession.guest_name as string) || 'Invitado',
            avatarUrl: (newSession.guest_avatar_url as string) || '',
            preview: '',
            time: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`,
            lastMessageAt: now.toISOString(),
            unread: 0,
            status: (newSession.status as string) ?? 'active',
            email: (newSession.guest_email as string) || undefined,
            isGoogleAuth: !!newSession.auth_user_id,
          };
          setSessions((prev) => {
            if (prev.some((c) => c.id === newChat.id)) return prev;
            return [newChat, ...prev];
          });
        },
      )
      .subscribe((status: string, err?: Error) => {
        chatDebug('sessionChannel:status', {
          businessId,
          status,
          error: err?.message,
        });
      });

    // Subscribe to store_lite messages
    const messageChannel = supabase
      .channel('public:messages_owner')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        async (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
          const newMessage = payload.new;
          chatDebug('messageChannel:insert', {
            sessionId: String(newMessage.session_id),
            messageId: String(newMessage.id),
          });

          const msgDate = new Date(String(newMessage.created_at));
          const mappedMsg: Message = {
            id: String(newMessage.id),
            text: String(newMessage.content ?? ''),
            sender: newMessage.is_from_store ? 'me' : 'them',
            time: `${padTwo(msgDate.getHours())}:${padTwo(msgDate.getMinutes())}`,
            chatId: String(newMessage.session_id),
            createdAt: newMessage.created_at
              ? new Date(String(newMessage.created_at)).toISOString()
              : '',
          };

          // Skip messages we already confirmed via the server response
          if (confirmedIdsRef.current.has(mappedMsg.id)) {
            chatDebug('messageChannel:skip-confirmed', { messageId: mappedMsg.id });
            return;
          }

          // Update local cache
          const sessionId = String(newMessage.session_id);
          setMessagesByChatId((prev) => {
            const chatMessages = prev[sessionId] ?? [];
            if (chatMessages.some((m) => m.id === mappedMsg.id)) return prev;
            return { ...prev, [sessionId]: [...chatMessages, mappedMsg] };
          });

          // Update preview in sidebar + INCREMENT UNREAD for non-selected chats
          const previewText = mappedMsg.sender === 'me' ? `Tú: ${mappedMsg.text}` : mappedMsg.text;
          const previewTime = formatMessageTime(new Date(String(newMessage.created_at)));
          setSessions((prev) =>
            prev.map((chat) =>
              chat.id === String(newMessage.session_id)
                ? {
                    ...chat,
                    preview: previewText,
                    time: previewTime,
                    lastMessageAt: String(newMessage.created_at),
                    unread:
                      chat.id === selectedSessionRef.current?.id
                        ? chat.unread
                        : (chat.unread ?? 0) + 1,
                  }
                : chat,
            ),
          );
        },
      )
      .subscribe((status: string, err?: Error) => {
        chatDebug('messageChannel:status', {
          businessId,
          status,
          error: err?.message,
        });
      });

    // Subscribe to WhatsApp messages (if channel exists)
    let whatsappMessageChannel: ReturnType<typeof supabase.channel> | null = null;
    if (whatsappChannelId) {
      whatsappMessageChannel = supabase
        .channel('public:whatsapp_messages_owner')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'whatsapp_messages',
            filter: `channel_id=eq.${whatsappChannelId}`,
          },
          async (payload: RealtimePostgresInsertPayload<Record<string, unknown>>) => {
            const newMessage = payload.new;
            chatDebug('whatsappMessageChannel:insert', {
              conversationId: String(newMessage.conversation_id),
              messageId: String(newMessage.id),
            });

            const msgDate = new Date(String(newMessage.created_at));
            const mappedMsg: Message = {
              id: String(newMessage.id),
              text: String(newMessage.body ?? ''),
              sender: newMessage.direction === 'outbound' ? 'me' : 'them',
              time: `${padTwo(msgDate.getHours())}:${padTwo(msgDate.getMinutes())}`,
              chatId: String(newMessage.conversation_id),
              createdAt: newMessage.created_at
                ? new Date(String(newMessage.created_at)).toISOString()
                : '',
            };

            // Update local cache
            const conversationId = String(newMessage.conversation_id);
            setMessagesByChatId((prev) => {
              const chatMessages = prev[conversationId] ?? [];
              if (chatMessages.some((m) => m.id === mappedMsg.id)) return prev;
              return { ...prev, [conversationId]: [...chatMessages, mappedMsg] };
            });

            // Update preview in sidebar + INCREMENT UNREAD for non-selected chats
            const previewText =
              mappedMsg.sender === 'me' ? `Tú: ${mappedMsg.text}` : mappedMsg.text;
            const previewTime = formatMessageTime(new Date(String(newMessage.created_at)));
            setSessions((prev) =>
              prev.map((chat) =>
                chat.id === String(newMessage.conversation_id)
                  ? {
                      ...chat,
                      preview: previewText,
                      time: previewTime,
                      lastMessageAt: String(newMessage.created_at),
                      unread:
                        chat.id === selectedSessionRef.current?.id
                          ? chat.unread
                          : (chat.unread ?? 0) + 1,
                    }
                  : chat,
              ),
            );
          },
        )
        .subscribe((status: string, err?: Error) => {
          chatDebug('whatsappMessageChannel:status', {
            businessId,
            status,
            error: err?.message,
          });
        });
    }

    return () => {
      chatDebug('subscriptions:cleanup', { businessId });
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(messageChannel);
      if (whatsappMessageChannel) {
        supabase.removeChannel(whatsappMessageChannel);
      }
    };
  }, [businessId, supabase]);

  // ─── Polling fallback: refresh messages every 5s as safety net ─────
  useEffect(() => {
    if (!selectedSession) return;
    const sessionId = selectedSession.id;
    const isWhatsApp = selectedSession.source === 'whatsapp';
    chatDebug('poll:start', { sessionId, isWhatsApp });

    const pollMessages = async () => {
      if (isWhatsApp) {
        const result = await fetchWhatsAppMessages(selectedSession.conversationId!);
        if (!result.success || !result.messages) return;

        setMessagesByChatId((prev) => {
          const mapped: Message[] = result.messages!.map((m) => ({
            id: String(m.id),
            text: m.body ?? '',
            sender: m.direction === 'outbound' ? 'me' : 'them',
            time: m.createdAt
              ? `${padTwo(new Date(m.createdAt).getHours())}:${padTwo(new Date(m.createdAt).getMinutes())}`
              : '',
            chatId: sessionId,
            createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
          }));
          const dbIds = new Set(mapped.map((m) => m.id));

          const existing = prev[sessionId] ?? [];
          const pendingTemps = existing.filter((m) => {
            if (!m.id.startsWith('temp-')) return false;
            return !mapped.some(
              (db) =>
                db.text === m.text &&
                Math.abs(new Date(db.createdAt).getTime() - new Date(m.createdAt).getTime()) < 5000,
            );
          });

          const merged = [...mapped, ...pendingTemps];
          const seen = new Set<string>();
          const deduped = merged.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          deduped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

          if (
            deduped.length === existing.length &&
            deduped.every((m, i) => m.id === existing[i].id && m.text === existing[i].text)
          ) {
            return prev;
          }
          return { ...prev, [sessionId]: deduped };
        });
      } else {
        const result = await fetchMessages(sessionId);
        if (!result.success || !result.messages) return;

        setMessagesByChatId((prev) => {
          const mapped: Message[] = result.messages!.map((m) => ({
            id: String(m.id),
            text: m.content || '',
            sender: m.isFromStore ? 'me' : 'them',
            time: m.createdAt
              ? `${padTwo(new Date(m.createdAt).getHours())}:${padTwo(new Date(m.createdAt).getMinutes())}`
              : '',
            chatId: String(m.sessionId),
            createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
          }));
          const dbIds = new Set(mapped.map((m) => m.id));

          const existing = prev[sessionId] ?? [];
          const pendingTemps = existing.filter((m) => {
            if (!m.id.startsWith('temp-')) return false;
            return !mapped.some(
              (db) =>
                db.text === m.text &&
                Math.abs(new Date(db.createdAt).getTime() - new Date(m.createdAt).getTime()) < 5000,
            );
          });

          const merged = [...mapped, ...pendingTemps];
          const seen = new Set<string>();
          const deduped = merged.filter((m) => {
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          deduped.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

          if (
            deduped.length === existing.length &&
            deduped.every((m, i) => m.id === existing[i].id && m.text === existing[i].text)
          ) {
            return prev;
          }
          return { ...prev, [sessionId]: deduped };
        });
      }
    };

    const intervalId = setInterval(pollMessages, 5000);
    return () => {
      clearInterval(intervalId);
    };
  }, [selectedSession]);

  // ─── Sessions polling fallback: refresh sidebar every 10s ──────────
  // This runs regardless of selectedSession, ensuring new messages and
  // session updates appear even if Realtime misses an event.
  useEffect(() => {
    chatDebug('sessionsPoll:start', { businessId, filterTab });

    const pollSessions = async () => {
      if (filterTab === 'whatsapp') {
        // Poll WhatsApp conversations
        const result = await fetchWhatsAppConversations(businessId);
        if (!result.success) return;

        setWhatsAppChannelConnected(result.channelConnected ?? true);
        if (!result.channelConnected) return;
        const resolvedChannelId = resolveChannelId(result);
        if (resolvedChannelId) setWhatsAppChannelId(resolvedChannelId);
        if (!result.conversations) return;

        setSessions((prev) => {
          const freshMap = new Map(
            result.conversations!.map((c) => {
              const lastMsg = c.lastMessage;
              return [
                c.id,
                {
                  id: c.id,
                  name: c.customerName || c.customerPhone || 'Cliente WhatsApp',
                  preview: lastMsg
                    ? `${lastMsg.direction === 'outbound' ? 'Tú: ' : ''}${lastMsg.body ?? ''}`
                    : 'Conversación iniciada',
                  time: lastMsg?.createdAt
                    ? formatMessageTime(new Date(lastMsg.createdAt))
                    : c.lastMessageAt
                      ? formatMessageTime(new Date(c.lastMessageAt))
                      : '',
                  lastMessageAt: lastMsg?.createdAt
                    ? new Date(lastMsg.createdAt).toISOString()
                    : c.lastMessageAt
                      ? new Date(c.lastMessageAt).toISOString()
                      : new Date().toISOString(),
                  unread: 0,
                  avatarUrl: '',
                  status: c.status ?? 'active',
                  source: 'whatsapp' as const,
                  channelId: c.channelId,
                  conversationId: c.id,
                } as Chat,
              ] as const;
            }),
          );

          // Merge: preserve unread from existing sessions, add new ones,
          // and detect new messages missed by Realtime via lastMessageAt diff.
          const merged: Chat[] = [];
          const initial = !sessionsPolledRef.current;

          for (const fresh of freshMap.values()) {
            const existing = prev.find((c) => c.id === fresh.id);
            if (existing) {
              // After the first poll, detect new messages by comparing timestamps.
              // Only increment for non-selected chats to avoid false positives.
              const hasNewMsg =
                !initial &&
                existing.lastMessageAt !== fresh.lastMessageAt &&
                existing.id !== selectedSessionRef.current?.id;

              merged.push({
                ...fresh,
                unread: hasNewMsg ? (existing.unread ?? 0) + 1 : existing.unread,
              });
            } else {
              // Brand new session — start with 0 unread
              merged.push(fresh);
            }
          }

          sessionsPolledRef.current = true;

          // Add sessions in prev that are no longer returned by fetch
          for (const existing of prev) {
            if (!freshMap.has(existing.id)) {
              merged.push(existing);
            }
          }
          return merged;
        });
      } else {
        // Poll store_lite chat sessions
        const result = await fetchChatSessions(businessId);
        if (!result.success || !result.sessions) return;

        setSessions((prev) => {
          const freshMap = new Map(
            result.sessions!.map((s) => {
              const lastMsg = s.messages?.[0] ?? null;
              return [
                s.id,
                {
                  id: s.id,
                  name: s.guestName || 'Invitado',
                  preview: lastMsg
                    ? `${lastMsg.isFromStore ? 'Tú: ' : ''}${lastMsg.content}`
                    : 'Chat iniciado',
                  time: lastMsg?.createdAt
                    ? formatMessageTime(new Date(lastMsg.createdAt))
                    : s.createdAt
                      ? formatMessageTime(new Date(s.createdAt))
                      : '',
                  lastMessageAt: lastMsg?.createdAt
                    ? new Date(lastMsg.createdAt).toISOString()
                    : s.createdAt
                      ? new Date(s.createdAt).toISOString()
                      : new Date().toISOString(),
                  unread: 0,
                  avatarUrl: s.guestAvatarUrl || '',
                  status: s.status ?? 'active',
                  email: s.guestEmail || undefined,
                  isGoogleAuth: !!s.authUserId,
                  isOrderChat: !!s.paymentId,
                  orderNumber: s.payment?.orderNumber || undefined,
                  source: 'store_lite' as const,
                } as Chat,
              ] as const;
            }),
          );

          // Merge: preserve unread from existing sessions, add new ones,
          // and detect new messages missed by Realtime via lastMessageAt diff.
          const merged: Chat[] = [];
          const initial = !sessionsPolledRef.current;

          for (const fresh of freshMap.values()) {
            const existing = prev.find((c) => c.id === fresh.id);
            if (existing) {
              // After the first poll, detect new messages by comparing timestamps.
              // Only increment for non-selected chats to avoid false positives.
              const hasNewMsg =
                !initial &&
                existing.lastMessageAt !== fresh.lastMessageAt &&
                existing.id !== selectedSessionRef.current?.id;

              merged.push({
                ...fresh,
                unread: hasNewMsg ? (existing.unread ?? 0) + 1 : existing.unread,
              });
            } else {
              // Brand new session — start with 0 unread
              merged.push(fresh);
            }
          }

          sessionsPolledRef.current = true;

          // Add sessions in prev that are no longer returned by fetch
          for (const existing of prev) {
            if (!freshMap.has(existing.id)) {
              merged.push(existing);
            }
          }
          return merged;
        });
      }
    };

    const intervalId = setInterval(pollSessions, 10000);
    return () => {
      clearInterval(intervalId);
    };
  }, [businessId, filterTab]);

  // Toggle body class for mobile navbar visibility
  useEffect(() => {
    if (selectedSession) {
      document.body.classList.add('is-chat-active');
    } else {
      document.body.classList.remove('is-chat-active');
    }
    return () => {
      document.body.classList.remove('is-chat-active');
    };
  }, [selectedSession]);

  const filteredByTab = sessions.filter((chat) => {
    if (filterTab === 'unread') return chat.status !== 'closed' && (chat.unread ?? 0) > 0;
    if (filterTab === 'orders') return chat.status !== 'closed' && chat.isOrderChat;
    if (filterTab === 'whatsapp') return chat.source === 'whatsapp';
    return chat.status !== 'closed' && chat.source !== 'whatsapp';
  });

  const filteredSessions = filteredByTab.filter((chat) =>
    chat.name.toLowerCase().includes(chatSearchQuery.toLowerCase()),
  );

  // ─── Sorted chats: pinned at top (custom order), unpinned by recency ──
  const sortedChats = useMemo(() => {
    const pinnedRank = new Map(
      chatOrderIds.filter((id) => pinnedChatIds.includes(id)).map((id, idx) => [id, idx]),
    );

    return [...filteredSessions].sort((a, b) => {
      const aPin = pinnedChatIds.includes(a.id);
      const bPin = pinnedChatIds.includes(b.id);

      // Pinned first
      if (aPin && !bPin) return -1;
      if (!aPin && bPin) return 1;

      if (aPin && bPin) {
        // Pinned: custom drag & drop order
        return (pinnedRank.get(a.id) ?? 999999) - (pinnedRank.get(b.id) ?? 999999);
      }

      // Unpinned: most recent message first
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
    });
  }, [filteredSessions, pinnedChatIds, chatOrderIds]);

  const activeMessages = messages.filter(
    (m) =>
      selectedSession &&
      m.chatId === selectedSession.id &&
      m.text.toLowerCase().includes(messageSearchQuery.toLowerCase()),
  );

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleSelectChat = useCallback(
    (id: string) => {
      const session = sessions.find((s) => s.id === id) || null;
      setSelectedSession(session);

      // Reset unread for the selected chat
      if (session) {
        setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, unread: 0 } : s)));
      }
    },
    [sessions],
  );

  const handleSendMessage = async (text: string) => {
    if (!selectedSession || !canRespond) return;

    const sessionId = selectedSession.id;
    const isWhatsApp = selectedSession.source === 'whatsapp';
    const tempId = `temp-${Date.now()}`;
    const now = new Date();

    // Optimistic add — show message instantly
    setMessagesByChatId((prev) => {
      const chatMessages = prev[sessionId] ?? [];
      return {
        ...prev,
        [sessionId]: [
          ...chatMessages,
          {
            id: tempId,
            text,
            sender: 'me',
            time: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`,
            chatId: sessionId,
            createdAt: now.toISOString(),
          },
        ],
      };
    });

    if (isWhatsApp) {
      const result = await sendWhatsAppMessage({
        conversationId: selectedSession.conversationId!,
        channelId: selectedSession.channelId!,
        type: 'text',
        body: text,
      });

      if (result.success && result.message) {
        const realId = String(result.message.id);
        confirmedIdsRef.current.add(realId);
        setTimeout(() => confirmedIdsRef.current.delete(realId), 2000);

        setMessagesByChatId((prev) => {
          const chatMessages = prev[sessionId] ?? [];
          return {
            ...prev,
            [sessionId]: chatMessages.map((m) =>
              m.id === tempId
                ? {
                    id: realId,
                    text: result.message!.body,
                    sender: 'me',
                    time: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`,
                    chatId: sessionId,
                    createdAt: result.message!.createdAt
                      ? new Date(result.message!.createdAt).toISOString()
                      : now.toISOString(),
                  }
                : m,
            ),
          };
        });
      } else {
        setMessagesByChatId((prev) => {
          const chatMessages = prev[sessionId] ?? [];
          return {
            ...prev,
            [sessionId]: chatMessages.filter((m) => m.id !== tempId),
          };
        });
        setSnackbar({
          open: true,
          message: 'Error al enviar mensaje por WhatsApp',
          severity: 'error',
        });
      }
    } else {
      const result = await sendMessage({
        sessionId: sessionId,
        isFromStore: true,
        content: text,
      });

      if (result.success && result.message) {
        const realId = String(result.message.id);
        confirmedIdsRef.current.add(realId);
        setTimeout(() => confirmedIdsRef.current.delete(realId), 2000);

        setMessagesByChatId((prev) => {
          const chatMessages = prev[sessionId] ?? [];
          return {
            ...prev,
            [sessionId]: chatMessages.map((m) =>
              m.id === tempId
                ? {
                    id: realId,
                    text: result.message!.content,
                    sender: 'me',
                    time: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`,
                    chatId: sessionId,
                    createdAt: result.message!.createdAt
                      ? new Date(result.message!.createdAt).toISOString()
                      : now.toISOString(),
                  }
                : m,
            ),
          };
        });
      } else {
        setMessagesByChatId((prev) => {
          const chatMessages = prev[sessionId] ?? [];
          return {
            ...prev,
            [sessionId]: chatMessages.filter((m) => m.id !== tempId),
          };
        });
        setSnackbar({
          open: true,
          message: 'Error al enviar mensaje',
          severity: 'error',
        });
      }
    }
  };

  const handleDeleteChat = () => {
    if (!selectedSession || !canManage) return;
    setIsDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!selectedSession) return;

    const result = await deleteChatSession(selectedSession.id);

    if (result.success) {
      const deletedId = selectedSession.id;
      setSessions((prev) => prev.filter((c) => c.id !== deletedId));
      setMessagesByChatId((prev) => {
        const { [deletedId]: _removed, ...rest } = prev;
        return rest;
      });
      loadedChatsRef.current.delete(deletedId);
      setSelectedSession(null);
      setIsDeleteDialogOpen(false);

      // Clean up order and pinned state
      setChatOrderIds((prev) => {
        const updated = prev.filter((id) => id !== deletedId);
        saveJSON(LS_ORDER, updated);
        return updated;
      });
      setPinnedChatIds((prev) => {
        const updated = prev.filter((id) => id !== deletedId);
        saveJSON(LS_PINNED, updated);
        return updated;
      });

      setSnackbar({
        open: true,
        message: 'Chat eliminado exitosamente',
        severity: 'success',
      });
    } else {
      setSnackbar({
        open: true,
        message: result.error || 'Error al eliminar el chat',
        severity: 'error',
      });
      setIsDeleteDialogOpen(false);
    }
  };

  const handlePinToggle = useCallback((id: string) => {
    setPinnedChatIds((prev) => {
      const next = prev.includes(id) ? prev.filter((pid) => pid !== id) : [...prev, id];
      saveJSON(LS_PINNED, next);
      return next;
    });
  }, []);

  const handleReorder = useCallback((draggedId: string, targetId: string) => {
    setChatOrderIds((prev) => {
      const dragIdx = prev.indexOf(draggedId);
      const targetIdx = prev.indexOf(targetId);
      if (dragIdx === -1 || targetIdx === -1) return prev;

      const newOrder = prev.filter((id) => id !== draggedId);
      const newTargetIdx = newOrder.indexOf(targetId);
      newOrder.splice(newTargetIdx, 0, draggedId);
      saveJSON(LS_ORDER, newOrder);
      return newOrder;
    });
  }, []);

  const handleShareChat = () => {
    if (!selectedSession || isShareConfirmed) return;

    navigator.clipboard.writeText(window.location.href).catch((err) => {
      console.error('Failed to copy:', err);
    });

    setIsShareConfirmed(true);
    setSnackbar({
      open: true,
      message: 'Enlace de chat copiado al portapapeles',
      severity: 'success',
    });

    setTimeout(() => {
      setIsShareConfirmed(false);
    }, 2000);
  };

  const handleSnackbarClose = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const handleWhatsAppConnectSuccess = useCallback(() => {
    setShowWhatsAppConnectModal(false);
    setWhatsAppConnectData(null);
    // Trigger a refresh of the WhatsApp conversations
    // The sessions effect will re-run because filterTab is 'whatsapp'
  }, []);

  const handleOpenWhatsAppConnect = useCallback(async () => {
    try {
      const response = await fetch('/api/seller/whatsapp/connect/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Error al iniciar la conexión de WhatsApp');
      }

      // The YCloud account already has a CONNECTED number: init adopted it,
      // so no pairing modal is needed. Refresh the channel state so the UI
      // shows the connected channel.
      if (data.status === 'connected') {
        setShowWhatsAppConnectModal(false);
        setWhatsAppConnectData(null);

        const result = await fetchWhatsAppConversations(businessId);
        if (result.success) {
          setWhatsAppChannelConnected(result.channelConnected ?? true);
          const resolvedChannelId = resolveChannelId(result);
          if (resolvedChannelId) setWhatsAppChannelId(resolvedChannelId);
        }

        setSnackbar({
          open: true,
          message: 'WhatsApp conectado correctamente',
          severity: 'success',
        });
        return;
      }

      setWhatsAppConnectData(data);
      setShowWhatsAppConnectModal(true);
    } catch (err) {
      setSnackbar({
        open: true,
        message: err instanceof Error ? err.message : 'Error al iniciar la conexión de WhatsApp',
        severity: 'error',
      });
    }
  }, [businessId]);

  const handleWhatsAppConnectModalClose = useCallback(() => {
    setShowWhatsAppConnectModal(false);
    setWhatsAppConnectData(null);
  }, []);

  return (
    <div className={`${styles.chatContainer} ${selectedSession ? styles.hasSelectedChat : ''}`}>
      <div className={styles.sidebarWrapper}>
        <ChatSidebar
          chats={sortedChats}
          selectedChatId={selectedSession?.id || null}
          onSelectChat={handleSelectChat}
          searchQuery={chatSearchQuery}
          onSearchChange={setChatSearchQuery}
          isLoading={isSessionsLoading}
          filterTab={filterTab}
          onFilterTabChange={setFilterTab}
          isPinning={isPinning}
          onPinningToggle={() => setIsPinning((prev) => !prev)}
          pinnedChatIds={pinnedChatIds}
          onTogglePin={handlePinToggle}
          chatOrderIds={chatOrderIds}
          onReorder={handleReorder}
          canManage={canManage}
          storeLogo={storeLogo}
          whatsappChannelConnected={whatsappChannelConnected}
          onConnectWhatsApp={handleOpenWhatsAppConnect}
          onOpenTemplates={whatsappChannelId ? () => setIsTemplateManagerOpen(true) : undefined}
        />
      </div>
      <div className={styles.windowWrapper}>
        <ChatWindow
          session={selectedSession}
          messages={activeMessages}
          storeName={storeName}
          storeDescription={
            storeDescription ||
            'Gestiona las conversaciones con tus clientes desde aquí. Selecciona un chat para comenzar.'
          }
          onSendMessage={handleSendMessage}
          searchQuery={messageSearchQuery}
          onSearchChange={setMessageSearchQuery}
          onDeleteChat={handleDeleteChat}
          onShareChat={handleShareChat}
          isShareConfirmed={isShareConfirmed}
          onBack={() => setSelectedSession(null)}
          slug={slug}
          isLoading={isMessagesLoading}
        />
      </div>
      <DeleteChatDialog
        open={isDeleteDialogOpen}
        chatName={selectedSession?.name ?? null}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleConfirmDelete}
      />
      {whatsappChannelId && (
        <WhatsAppTemplateManager
          channelId={whatsappChannelId}
          open={isTemplateManagerOpen}
          onClose={() => setIsTemplateManagerOpen(false)}
        />
      )}
      {showWhatsAppConnectModal && whatsAppConnectData && (
        <WhatsAppConnectModal
          phoneNumberId={whatsAppConnectData.phoneNumberId}
          code={whatsAppConnectData.code}
          expiresAt={whatsAppConnectData.expiresAt}
          onClose={handleWhatsAppConnectModalClose}
          onSuccess={handleWhatsAppConnectSuccess}
        />
      )}
      <AlertSnackbar
        open={snackbar.open}
        description={snackbar.message}
        color={snackbar.severity}
        onClose={handleSnackbarClose}
      />
    </div>
  );
}
