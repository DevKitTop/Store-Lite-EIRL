import { CircularProgress, Icon, IconButton, Button } from '@/shared/components/ui';
import Image from 'next/image';
import { useCallback, useState } from 'react';
import styles from './ChatSidebar.module.css';

import type { Chat } from './ChatClient';

type FilterTab = 'all' | 'unread' | 'orders' | 'whatsapp';

interface ChatSidebarProps {
  chats: Chat[];
  selectedChatId: string | null;
  onSelectChat: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  isLoading?: boolean;
  filterTab: FilterTab;
  onFilterTabChange: (tab: FilterTab) => void;
  isPinning: boolean;
  onPinningToggle: () => void;
  pinnedChatIds: string[];
  onTogglePin: (id: string) => void;
  chatOrderIds: string[];
  onReorder: (draggedId: string, targetId: string) => void;
  canManage: boolean;
  storeLogo: string;
  // WhatsApp specific
  whatsappChannelConnected?: boolean;
  onConnectWhatsApp?: () => void;
  onOpenTemplates?: () => void;
}

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Todo' },
  { key: 'orders', label: 'Ventas' },
  { key: 'unread', label: 'Sin leer' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

export function ChatSidebar({
  chats,
  selectedChatId,
  onSelectChat,
  searchQuery,
  onSearchChange,
  isLoading = false,
  filterTab,
  onFilterTabChange,
  isPinning,
  onPinningToggle,
  pinnedChatIds,
  onTogglePin,
  onReorder,
  canManage,
  storeLogo,
  whatsappChannelConnected = true,
  onConnectWhatsApp,
  onOpenTemplates,
}: ChatSidebarProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Separate pinned vs unpinned for visual sections
  const pinnedChats = chats.filter((c) => pinnedChatIds.includes(c.id));
  const unpinnedChats = chats.filter((c) => !pinnedChatIds.includes(c.id));

  const handleChatClick = (chatId: string) => {
    if (isPinning) {
      onTogglePin(chatId);
    } else {
      onSelectChat(chatId);
    }
  };

  // ─── Drag & Drop (pinned chats only) ─────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent, chatId: string) => {
      if (!isPinning) return;
      // Only pinned chats are draggable
      if (!pinnedChatIds.includes(chatId)) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', chatId);
      e.dataTransfer.effectAllowed = 'move';
      setDraggedId(chatId);
    },
    [isPinning, pinnedChatIds],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent, chatId: string) => {
      if (!isPinning || !draggedId || draggedId === chatId) return;

      // Only accept drops on pinned targets
      if (!pinnedChatIds.includes(chatId)) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverId(chatId);
    },
    [isPinning, draggedId, pinnedChatIds],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetChatId: string) => {
      e.preventDefault();
      setDragOverId(null);
      setDraggedId(null);

      const sourceId = e.dataTransfer.getData('text/plain');
      if (!sourceId || sourceId === targetChatId) return;

      // Only pinned-to-pinned drops
      if (!pinnedChatIds.includes(sourceId) || !pinnedChatIds.includes(targetChatId)) return;

      onReorder(sourceId, targetChatId);
    },
    [pinnedChatIds, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDraggedId(null);
    setDragOverId(null);
  }, []);

  // ─── Render a single chat item ─────────────────────────────────────
  const renderChatItem = (chat: Chat) => {
    const isSelected = chat.id === selectedChatId;
    const isPinned = pinnedChatIds.includes(chat.id);
    const hasUnread = (chat.unread ?? 0) > 0;

    return (
      <div
        key={chat.id}
        draggable={isPinning && isPinned}
        className={`
          ${styles.chatItem}
          ${isSelected && !isPinning ? styles.active : ''}
          ${isPinning ? styles.chatItemPinning : ''}
          ${draggedId === chat.id ? styles.chatItemDragging : ''}
          ${dragOverId === chat.id ? styles.chatItemDragOver : ''}
        `}
        onClick={() => handleChatClick(chat.id)}
        onDragStart={(e) => handleDragStart(e, chat.id)}
        onDragOver={(e) => handleDragOver(e, chat.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, chat.id)}
        onDragEnd={handleDragEnd}
      >
        {/* Pin icon (visible in pin mode) */}
        {isPinning && (
          <div
            className={`${styles.pinIcon} ${isPinned ? styles.pinIconActive : styles.pinIconInactive}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(chat.id);
            }}
          >
            <Icon size={20}>{isPinned ? 'push_pin' : 'push_pin'}</Icon>
          </div>
        )}

        {/* Avatar */}
        <div className={styles.avatarContainer}>
          {chat.avatarUrl ? (
            <Image
              src={chat.avatarUrl}
              alt={`Avatar de ${chat.name}`}
              className={styles.avatar}
              width={44}
              height={44}
            />
          ) : (
            <div className={styles.avatarFallback}>
              <Icon size={22}>person</Icon>
            </div>
          )}
        </div>

        {/* Chat Info */}
        <div className={styles.chatInfo}>
          <div className={styles.chatTopLine}>
            <span className={styles.chatName}>{chat.name}</span>
            <div className={styles.chatTimeRow}>
              <span className={styles.chatTime}>{chat.time}</span>
              {hasUnread && <span className={styles.unreadDot} />}
            </div>
          </div>
          <div className={styles.chatBottomLine}>
            <span className={`${styles.chatPreview} ${hasUnread ? styles.previewBold : ''}`}>
              {chat.preview}
            </span>
            {hasUnread && <span className={styles.unreadBadge}>{chat.unread}</span>}
          </div>
          {chat.isOrderChat && (
            <div className={styles.orderBadge}>
              <span className={styles.orderBadgeText}>
                {chat.orderNumber ? `#${chat.orderNumber}` : 'Orden'}
              </span>
            </div>
          )}
        </div>

        {/* Pin indicator (small icon on pinned chats in normal mode) */}
        {!isPinning && isPinned && (
          <div className={styles.pinIndicator}>
            <Icon size={16}>push_pin</Icon>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className={styles.sidebar}>
      {/* Header */}
      <header className={styles.header}>
        <h2 className={styles.title}>{isPinning ? 'Personalizar' : 'Mensajes'}</h2>
        <div className={styles.headerActions}>
          {filterTab === 'whatsapp' && whatsappChannelConnected && onOpenTemplates && (
            <IconButton
              aria-label="Plantillas de WhatsApp"
              className={styles.editButton}
              onClick={onOpenTemplates}
            >
              <Icon>description</Icon>
            </IconButton>
          )}
          {canManage && (
            <IconButton
              aria-label={isPinning ? 'Terminar' : 'Personalizar lista'}
              className={`${styles.editButton} ${isPinning ? styles.editButtonActive : ''}`}
              onClick={onPinningToggle}
            >
              <Icon>{isPinning ? 'close' : 'push_pin'}</Icon>
            </IconButton>
          )}
        </div>
      </header>

      {/* Filter Tabs */}
      <div className={styles.filterTabs}>
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.filterTab} ${filterTab === tab.key ? styles.filterTabActive : ''}`}
            onClick={() => onFilterTabChange(tab.key)}
          >
            {tab.label}
            {tab.key === 'unread' && chats.some((c) => (c.unread ?? 0) > 0) && (
              <span className={styles.filterUnreadCount}>
                {chats.reduce((acc, c) => acc + (c.unread ?? 0), 0)}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search Bar */}
      <div className={styles.searchContainer}>
        <div className={styles.searchInputWrapper}>
          <Icon size={20} className={styles.searchIcon}>
            search
          </Icon>
          <input
            type="text"
            placeholder="Buscar contactos"
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      {/* Chat List */}
      <div className={styles.chatList}>
        {isLoading ? (
          <div className={styles.loadingContainer}>
            <CircularProgress indeterminate />
          </div>
        ) : (
          <>
            {/* Pinned section */}
            {pinnedChats.length > 0 && (
              <>
                <div className={styles.pinnedLabel}>Fijados</div>
                {pinnedChats.map(renderChatItem)}
                <div className={styles.pinnedDivider} />
              </>
            )}

            {/* Unpinned section */}
            {unpinnedChats.map(renderChatItem)}

            {chats.length === 0 && (
              <div className={styles.emptyState}>
                {filterTab === 'unread'
                  ? 'No hay mensajes sin leer'
                  : filterTab === 'orders'
                    ? 'No hay ventas con chat'
                    : filterTab === 'whatsapp' && !whatsappChannelConnected ? (
                      <div className={styles.whatsappEmptyState}>
                        <div className={styles.whatsappEmptyIcon}>💬</div>
                        <p className={styles.whatsappEmptyTitle}>Conectá tu WhatsApp</p>
                        <p className={styles.whatsappEmptyText}>
                          Respondé a tus clientes desde acá. Tardás menos de 2 minutos.
                        </p>
                        <Button
                          variant="filled"
                          className={styles.whatsappConnectBtn}
                          onClick={onConnectWhatsApp}
                        >
                          Conectar WhatsApp
                        </Button>
                      </div>
                    ) : (
                      'No hay conversaciones'
                    )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
