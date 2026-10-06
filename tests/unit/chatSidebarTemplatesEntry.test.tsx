import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatSidebar } from '../../app/[slug]/(app)/chat/components/ChatSidebar';

type FilterTab = 'all' | 'unread' | 'orders' | 'whatsapp';

function renderSidebar(overrides: {
  filterTab?: FilterTab;
  whatsappChannelConnected?: boolean;
  onOpenTemplates?: () => void;
} = {}) {
  const props = {
    chats: [],
    selectedChatId: null,
    onSelectChat: vi.fn(),
    searchQuery: '',
    onSearchChange: vi.fn(),
    filterTab: overrides.filterTab ?? 'whatsapp',
    onFilterTabChange: vi.fn(),
    isPinning: false,
    onPinningToggle: vi.fn(),
    pinnedChatIds: [],
    onTogglePin: vi.fn(),
    chatOrderIds: [],
    onReorder: vi.fn(),
    canManage: false,
    storeLogo: '',
    whatsappChannelConnected: overrides.whatsappChannelConnected ?? true,
    onConnectWhatsApp: vi.fn(),
    onOpenTemplates: overrides.onOpenTemplates,
  };
  render(<ChatSidebar {...(props as Parameters<typeof ChatSidebar>[0])} />);
  return props;
}

describe('ChatSidebar templates entry point', () => {
  it('shows the templates button on the WhatsApp tab when the channel is connected', () => {
    const onOpenTemplates = vi.fn();
    renderSidebar({ onOpenTemplates });

    const button = screen.getByLabelText('Plantillas de WhatsApp');
    expect(button).toBeInTheDocument();
  });

  it('opens the template manager when the templates button is pressed', () => {
    const onOpenTemplates = vi.fn();
    renderSidebar({ onOpenTemplates });

    fireEvent.click(screen.getByLabelText('Plantillas de WhatsApp'));

    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
  });

  it('hides the templates button when the WhatsApp channel is not connected', () => {
    renderSidebar({ whatsappChannelConnected: false });

    expect(screen.queryByLabelText('Plantillas de WhatsApp')).not.toBeInTheDocument();
  });

  it('hides the templates button on non-WhatsApp tabs', () => {
    renderSidebar({ filterTab: 'all' });

    expect(screen.queryByLabelText('Plantillas de WhatsApp')).not.toBeInTheDocument();
  });

  it('hides the templates button when no opener callback is provided', () => {
    renderSidebar({ onOpenTemplates: undefined });

    expect(screen.queryByLabelText('Plantillas de WhatsApp')).not.toBeInTheDocument();
  });
});