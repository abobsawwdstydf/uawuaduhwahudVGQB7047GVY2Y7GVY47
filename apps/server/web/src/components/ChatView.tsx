import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone,
  Video,
  MoreVertical,
  Search,
  X,
  ArrowDown,
  Trash2,
  UserPlus,
  UserMinus,
  Bell,
  BellOff,
  Settings,
  Eraser,
  Pin,
  Forward,
  Bookmark,
  ChevronDown,
  BarChart3,
  Menu,
} from 'lucide-react';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import { getSocket } from '../lib/socket';
import { isChatMuted, toggleMuteChat } from '../lib/sounds';
import { useLang } from '../lib/i18n';
import { formatLastSeen } from '../lib/utils';
import { normalizeMediaUrl } from '../lib/mediaUrl';
import type { UserBasic, Message } from '../lib/types';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import TypingIndicator from './TypingIndicator';
import UserProfile from './UserProfile';
import GroupSettings from './GroupSettings';
import ForwardModal from './ForwardModal';
import ConfirmModal from './ConfirmModal';
import Avatar from './Avatar';
import ChannelProfile from './ChannelProfile';
import ChannelStudio from './ChannelStudio';
import ThreadView from './ThreadView';
import { useThemeStore } from '../stores/themeStore';

export default function ChatView({ onStartCall, onStartGroupCall }: { onStartCall?: (targetUser: UserBasic, type: 'voice' | 'video') => void; onStartGroupCall?: (chatId: string, chatName: string, type: 'voice' | 'video') => void }) {
  const { user } = useAuthStore();
  const { t, lang } = useLang();
  const { chatTheme } = useThemeStore();
  const {
    activeChat,
    chats,
    messages,
    typingUsers,
    pinnedMessages,
    isLoadingMessages,
    setActiveChat,
  } = useChatStore();

  const [showTopMenu, setShowTopMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [muted, setMuted] = useState(false);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState<Set<string>>(new Set());
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [showDeleteMenu, setShowDeleteMenu] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ message: string; action: () => void } | null>(null);
  const [scrollReady, setScrollReady] = useState(false);
  const [activeGroupCallParticipants, setActiveGroupCallParticipants] = useState<string[]>([]);
  const [isChannelSubscribed, setIsChannelSubscribed] = useState(true);
  const [showCallTypeMenu, setShowCallTypeMenu] = useState(false);
  const [showChannelStudio, setShowChannelStudio] = useState(false);
  const [showChannelProfile, setShowChannelProfile] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Listen for channel profile open events from MessageBubble
  useEffect(() => {
    const handleOpenChannelProfile = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.channelId) {
        setActiveChat(customEvent.detail.channelId);
        setShowChannelProfile(true);
      }
    };
    
    const handleOpenChannelStudio = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.channelId) {
        setActiveChat(customEvent.detail.channelId);
        setShowChannelStudio(true);
      }
    };
    
    window.addEventListener('open-channel-profile', handleOpenChannelProfile);
    window.addEventListener('open-channel-studio', handleOpenChannelStudio);

    // Listen for thread creation
    const handleCreateThread = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { messageId, chatId } = customEvent.detail || {};
      if (!messageId || !chatId) return;

      try {
        const thread = await api.createThread(chatId, messageId);
        if (thread?.id) {
          setActiveThreadId(thread.id);
        }
      } catch (err) {
        console.error('Failed to create thread:', err);
      }
    };

    window.addEventListener('create-thread', handleCreateThread);

    return () => {
      window.removeEventListener('open-channel-profile', handleOpenChannelProfile);
      window.removeEventListener('open-channel-studio', handleOpenChannelStudio);
      window.removeEventListener('create-thread', handleCreateThread);
    };
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const topMenuRef = useRef<HTMLDivElement>(null);
  const deleteMenuRef = useRef<HTMLDivElement>(null);
  const callTypeMenuRef = useRef<HTMLDivElement>(null);
  const chatViewRef = useRef<HTMLDivElement>(null);

  const chat = chats.find((c) => c.id === activeChat);
  const chatMessages = activeChat ? messages[activeChat] || [] : [];
  const pinnedMsg = activeChat ? pinnedMessages[activeChat] : null;

  // Количество непрочитанных сообщений (для бейджика)
  const unreadCount = chatMessages.filter(
    (m) => m.senderId !== user?.id && !m.readBy?.some((r) => r.userId === user?.id)
  ).length;

  const otherMember = chat?.members.find((m) => m.user.id !== user?.id);
  const isFavorites = chat?.type === 'favorites';
  const chatName = isFavorites
    ? t('favorites')
    : chat?.type === 'personal'
      ? otherMember?.user.displayName || otherMember?.user.username || t('chat')
      : chat?.name || t('group');
  const chatAvatar = isFavorites
    ? null
    : chat?.type === 'personal'
      ? otherMember?.user.avatar
      : chat?.avatar;
  const isOnline = chat?.type === 'personal' && otherMember?.user.isOnline;

  const typingInChat = typingUsers.filter((t) => t.chatId === activeChat && t.userId !== user?.id);
  const isChannel = chat?.type === 'channel';
  const showTypingIndicator = typingInChat.length > 0 && !isChannel;

  // Load muted state
  useEffect(() => {
    if (activeChat) {
      setMuted(isChatMuted(activeChat));
      setScrollReady(false);
      setActiveGroupCallParticipants([]);
    }
  }, [activeChat]);

  // Listen for active group calls
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (data: { chatId: string; participants: string[] }) => {
      if (data.chatId === activeChat) {
        setActiveGroupCallParticipants(data.participants.filter(p => p !== user?.id));
      }
    };
    socket.on('group_call_active', handler);
    // Request current status when opening a group chat
    if (activeChat && chat?.type === 'group') {
      socket.emit('group_call_status', { chatId: activeChat });
    }
    return () => { socket.off('group_call_active', handler); };
  }, [activeChat, user?.id, chat?.type]);

  // Track message views in channels
  useEffect(() => {
    if (!activeChat || !chat || chat.type !== 'channel') return;
    
    // Mark messages as viewed when they're visible
    const trackViews = async () => {
      const messageElements = document.querySelectorAll('[id^="msg-"]');
      const viewportHeight = window.innerHeight;
      
      for (const msgEl of Array.from(messageElements)) {
        const rect = msgEl.getBoundingClientRect();
        const messageId = msgEl.id.replace('msg-', '');
        
        // If message is visible in viewport
        if (rect.top >= 0 && rect.bottom <= viewportHeight) {
          try {
            await api.markPostViewed(messageId);
          } catch (e) {
            // Ignore errors
          }
        }
      }
    };
    
    // Track views after messages load
    const timer = setTimeout(trackViews, 1000);
    
    // Also track on scroll
    const handleScroll = () => {
      clearTimeout(timer);
      setTimeout(trackViews, 500);
    };
    
    const container = messagesContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
    }
    
    return () => {
      clearTimeout(timer);
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, [activeChat, chat?.type, messages]);

  // Close top menu on click outside
  useEffect(() => {
    if (!showTopMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (topMenuRef.current && !topMenuRef.current.contains(e.target as Node)) {
        setShowTopMenu(false);
      }
    };
    // Use setTimeout to avoid the same click that opened the menu from closing it
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [showTopMenu]);

  // Close delete menu on click outside
  useEffect(() => {
    if (!showDeleteMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (deleteMenuRef.current && !deleteMenuRef.current.contains(e.target as Node)) {
        setShowDeleteMenu(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [showDeleteMenu]);

  // Close call type menu on click outside
  useEffect(() => {
    if (!showCallTypeMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (callTypeMenuRef.current && !callTypeMenuRef.current.contains(e.target as Node)) {
        setShowCallTypeMenu(false);
      }
    };
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [showCallTypeMenu]);

  // Прокрутка вниз
  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'end' });
  }, []);

  // Первичная прокрутка при открытии чата или после загрузки (layout effect — до отрисовки)
  useLayoutEffect(() => {
    if (!isLoadingMessages && messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      setScrollReady(true);
    }
  }, [activeChat, isLoadingMessages]);

  // Scroll on new message arrivals
  useEffect(() => {
    if (chatMessages.length > 0) {
      const lastMsg = chatMessages[chatMessages.length - 1];
      if (lastMsg.senderId === user?.id) {
        setTimeout(() => scrollToBottom(true), 50);
      } else {
        // Если пользователь внизу — прокрутить
        const container = messagesContainerRef.current;
        if (container) {
          const isNearBottom =
            container.scrollHeight - container.scrollTop - container.clientHeight < 250;
          if (isNearBottom) setTimeout(() => scrollToBottom(true), 50);
        }
      }
    }
  }, [chatMessages.length, user?.id, scrollToBottom]);

  // Read receipts — debounced via ref to avoid excessive emits
  const sentReadIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!activeChat || !user?.id) return;
    // Reset tracked IDs when switching chats
    sentReadIdsRef.current.clear();
  }, [activeChat, user?.id]);

  useEffect(() => {
    if (!activeChat || !user?.id) return;
    const unread = chatMessages.filter(
      (m) => m.senderId !== user.id && !m.readBy?.some((r) => r.userId === user.id) && !sentReadIdsRef.current.has(m.id)
    );
    if (unread.length > 0) {
      const ids = unread.map((m) => m.id);
      ids.forEach((id) => sentReadIdsRef.current.add(id));
      const socket = getSocket();
      if (socket) {
        socket.emit('read_messages', {
          chatId: activeChat,
          messageIds: ids,
        });
      }
      // Update local store immediately for current user
      useChatStore.getState().markRead(activeChat, user.id, ids);
    }
  }, [chatMessages.length, activeChat, user?.id]);

  // Scroll detection
  const handleScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 200;
    setShowScrollDown(!isNearBottom);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!chatViewRef.current) return;
    const { left, top } = chatViewRef.current.getBoundingClientRect();
    chatViewRef.current.style.setProperty('--mouse-x', `${e.clientX - left}px`);
    chatViewRef.current.style.setProperty('--mouse-y', `${e.clientY - top}px`);
  };

  // Поиск сообщений на сервере
  useEffect(() => {
    if (!searchText.trim() || !activeChat) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await api.searchMessages(searchText, activeChat);
        setSearchResults(results);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300); // Debounce 300ms

    return () => clearTimeout(timer);
  }, [searchText, activeChat]);

  const openSearch = () => {
    setShowSearch(true);
    setShowTopMenu(false);
    setTimeout(() => searchInputRef.current?.focus(), 100);
  };

  if (!activeChat || !chat) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-surface-secondary relative z-0">
        {/* Slowly pulsing purple background */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden transition-opacity duration-[10000ms]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] bg-nexo-600/10 rounded-full blur-[120px] animate-[pulse_8s_ease-in-out_infinite]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] max-w-[500px] max-h-[500px] bg-purple-600/15 rounded-full blur-[100px] animate-[pulse_12s_ease-in-out_infinite_reverse]" />
        </div>

        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wMSkvPjwvc3ZnPg==')] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_100%)] opacity-20 pointer-events-none" />

        <div className="text-center relative z-10 w-full max-w-sm px-6 flex flex-col items-center justify-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="w-28 h-28 mx-auto mb-8 rounded-[2rem] bg-gradient-to-br from-nexo-500/20 to-purple-600/20 flex items-center justify-center shadow-[0_0_60px_-15px_var(--color-accent)] ring-1 ring-white/10 backdrop-blur-2xl relative select-none"
          >
            <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-br from-white/[0.05] to-transparent pointer-events-none" />
            <img src="/logo.png" alt="Nexo" className="w-16 h-16 rounded-2xl object-cover shadow-2xl transform hover:scale-105 transition-transform select-none pointer-events-none" draggable={false} />
          </motion.div>
          <motion.h2
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-nexo-400 via-fuchsia-400 to-indigo-400 mb-4 drop-shadow-lg tracking-tight select-none"
          >
            Nexo Messenger
          </motion.h2>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="text-sm font-medium text-zinc-300 bg-white/5 backdrop-blur-lg py-2.5 px-6 rounded-full inline-flex border border-white/10 shadow-lg select-none"
          >
            {t('selectChat')}
          </motion.p>
        </div>
      </div>
    );
  }

  const initials = chatName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleToggleSelect = (msgId: string) => {
    const newMap = new Set(selectedMessages);
    if (newMap.has(msgId)) {
      newMap.delete(msgId);
      if (newMap.size === 0) setSelectionMode(false);
    } else {
      newMap.add(msgId);
    }
    setSelectedMessages(newMap);
  };

  const handleStartSelection = (msgId: string) => {
    setSelectionMode(true);
    setSelectedMessages(new Set([msgId]));
  };

  const handleForward = (targetChatId: string) => {
    const socket = getSocket();
    if (!socket || !activeChat) return;

    const messagesToForward = Array.from(selectedMessages)
      .map(id => chatMessages.find(m => m.id === id))
      .filter(Boolean)
      .sort((a, b) => new Date(a!.createdAt).getTime() - new Date(b!.createdAt).getTime());

    messagesToForward.forEach(msg => {
      socket.emit('send_message', {
        chatId: targetChatId,
        content: msg?.content,
        type: msg?.type,
        forwardedFromId: msg?.sender.id,
        mediaUrl: msg?.media?.[0]?.url,
        mediaType: msg?.media?.[0]?.type,
        fileName: msg?.media?.[0]?.filename,
        fileSize: msg?.media?.[0]?.size ?? undefined,
      });
    });

    setSelectionMode(false);
    setSelectedMessages(new Set());
    setShowForwardModal(false);
    setActiveChat(targetChatId);
  };

  const handleBulkDelete = (deleteForAll: boolean) => {
    const socket = getSocket();
    if (!socket || !activeChat) return;

    const ids = Array.from(selectedMessages);
    socket.emit('delete_messages', {
      messageIds: ids,
      chatId: activeChat,
      deleteForAll,
    });

    // Optimistic local removal
    if (!deleteForAll) {
      useChatStore.getState().hideMessages(ids, activeChat);
    }

    setSelectionMode(false);
    setSelectedMessages(new Set());
    setShowDeleteMenu(false);
  };

  return (
    <div
      ref={chatViewRef}
      onMouseMove={handleMouseMove}
      className={`flex flex-col h-full w-full overflow-hidden chat-theme-${chatTheme} transition-colors duration-500 bg-surface-secondary`}
    >
      {/* Шапка чата */}
      {selectionMode ? (
        <div className="h-[60px] sm:h-[76px] flex items-center justify-between px-4 sm:px-6 border-b border-border/40 bg-[#09090b]/80 backdrop-blur-xl z-20 flex-shrink-0">
          <div className="flex items-center gap-4 text-white">
            <button onClick={() => { setSelectionMode(false); setSelectedMessages(new Set()); }} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition">
              <X size={20} className="text-zinc-300" />
            </button>
            <span className="font-medium text-[15px]">{selectedMessages.size} {t('selected') || 'выбрано'}</span>
          </div>
          <div className="flex items-center gap-3">
            {/* Кнопка удаления с выпадающим меню */}
            <div className="relative" ref={deleteMenuRef}>
              <button
                disabled={selectedMessages.size === 0}
                onClick={() => setShowDeleteMenu(!showDeleteMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/90 text-white font-medium rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                <Trash2 size={18} />
                {t('delete')}
              </button>
              <AnimatePresence>
                {showDeleteMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 rounded-2xl bg-[#09090b]/95 backdrop-blur-2xl shadow-2xl z-50 py-1.5 ring-1 ring-border/50 overflow-hidden"
                  >
                    <button
                      onClick={() => handleBulkDelete(false)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                    >
                      <Trash2 size={16} className="text-zinc-400" />
                      {t('deleteForMe')}
                    </button>
                    <div className="border-t border-border/30 mx-3" />
                    <button
                      onClick={() => handleBulkDelete(true)}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <Trash2 size={16} className="text-red-400" />
                      {t('deleteForAll')}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              disabled={selectedMessages.size === 0}
              onClick={() => setShowForwardModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-white text-black font-medium rounded-xl hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              <Forward size={18} />
              {t('forward')}
            </button>
          </div>
        </div>
      ) : (
        <div className="h-[60px] sm:h-[76px] flex items-center justify-between px-4 sm:px-6 border-b border-border/40 bg-[#09090b]/80 backdrop-blur-xl z-20 flex-shrink-0">
          <div className="flex items-center gap-3">
            {/* Кнопка открытия сайдбара */}
            <button
              onClick={() => {
                // Dispatch event to open sidebar in ChatPage
                window.dispatchEvent(new CustomEvent('toggle-sidebar'));
              }}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
              title="Меню"
            >
              <Menu size={20} />
            </button>
            
            <button
              className="flex items-center gap-3 min-w-0 flex-1 group transition-all"
              onClick={() => {
                if (chat.type === 'channel') {
                  setShowChannelProfile(true);
                } else if (chat.type === 'personal' && otherMember) {
                  setProfileUserId(otherMember.user.id);
                } else if (chat.type === 'group') {
                  setShowGroupSettings(true);
                }
              }}
            >
            <div className="relative flex-shrink-0 transform transition-transform duration-300 group-hover:scale-105">
              {isFavorites ? (
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg ring-2 ring-transparent group-hover:ring-accent/30 transition-all duration-300">
                  <Bookmark size={20} className="text-white" />
                </div>
              ) : (
                <Avatar
                  src={chatAvatar}
                  name={chatName}
                  size="md"
                  online={isOnline ? true : undefined}
                  className="ring-2 ring-transparent group-hover:ring-accent/30 transition-all duration-300 rounded-full"
                  isVerified={chat.isVerified}
                  verifiedBadgeUrl={chat.verifiedBadgeUrl}
                  verifiedBadgeType={chat.verifiedBadgeType}
                />
              )}
            </div>
            <div className="min-w-0 text-left">
              <h3 className="text-base font-semibold text-white truncate drop-shadow-sm group-hover:text-accent/90 transition-colors">{chatName}</h3>
              <p className="text-xs text-zinc-400 truncate">
                {isFavorites
                  ? t('favoritesDescription')
                  : showTypingIndicator
                    ? <span className="text-accent font-medium">{t('typing')}</span>
                    : isOnline
                      ? <span className="text-emerald-400">{t('online')}</span>
                      : chat.type === 'personal' && otherMember?.user.lastSeen
                        ? `${t('lastSeenAt')} ${formatLastSeen(otherMember.user.lastSeen, lang)}`
                        : chat.type === 'group'
                          ? `${chat.members.length} ${t('members')}`
                          : chat.type === 'channel'
                            ? `${chat.members.length} ${t('subscribers')}`
                            : ''}
              </p>
            </div>
          </button>

          {chat.type === 'channel' && !chat.members.some(m => m.user.id === user?.id && m.role === 'admin') && (
            <button
              onClick={async () => {
                try {
                  await api.deleteChat(activeChat);
                  useChatStore.getState().removeChat(activeChat);
                } catch (e) {
                  console.error(e);
                }
              }}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                isChannelSubscribed
                  ? 'bg-white/10 text-white hover:bg-red-500/20 hover:text-red-400'
                  : 'bg-nexo-500 text-white hover:bg-nexo-600'
              }`}
            >
              {isChannelSubscribed ? (t('unsubscribe') || 'Выйти') : (t('subscribe') || 'Подписаться')}
            </button>
          )}

          <div className="flex items-center gap-1.5 ml-4">
            {/* Поиск */}
            <AnimatePresence>
              {showSearch && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 200, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder={t('searchMessages')}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-surface-tertiary text-sm text-white placeholder-zinc-500 border border-border focus:border-accent"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={(e) => {
                e.stopPropagation();
                console.log('Search click, showSearch:', showSearch);
                if (showSearch) {
                  setShowSearch(false);
                  setSearchText('');
                } else {
                  openSearch();
                }
              }}
              className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white z-50 relative"
              style={{ pointerEvents: 'auto' }}
            >
              {showSearch ? <X size={18} /> : <Search size={18} />}
            </button>

            {!isFavorites && chat.type !== 'channel' && (
              <div className="relative">
                {/* Call button with dropdown menu */}
                <div className="relative" ref={callTypeMenuRef}>
                  <button
                    onClick={() => setShowCallTypeMenu(!showCallTypeMenu)}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-hover transition-colors text-emerald-400 hover:text-emerald-300"
                    title={t('call')}
                  >
                    <Phone size={18} />
                    <ChevronDown size={14} />
                  </button>

                  {/* Call type dropdown menu */}
                  <AnimatePresence>
                    {showCallTypeMenu && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -5 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -5 }}
                        className="absolute right-0 top-full mt-2 w-48 rounded-2xl glass-strong shadow-2xl z-50 py-1.5 ring-1 ring-border/50 backdrop-blur-2xl overflow-hidden"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowCallTypeMenu(false);
                        }}
                      >
                        <div className="px-3 py-2 border-b border-white/5">
                          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Тип звонка</p>
                        </div>
                        <button
                          onClick={() => {
                            if (chat.type === 'personal' && otherMember) {
                              onStartCall?.(otherMember.user, 'video');
                            } else if (chat.type === 'group') {
                              onStartGroupCall?.(chat.id, chat.name || 'Group', 'video');
                            }
                          }}
                          className="flex items-center gap-3 w-full px-4 py-3 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                            <Video size={16} className="text-purple-400" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-medium">Видеозвонок</p>
                            <p className="text-xs text-zinc-500">Видео + аудио</p>
                          </div>
                        </button>
                        <button
                          onClick={() => {
                            if (chat.type === 'personal' && otherMember) {
                              onStartCall?.(otherMember.user, 'voice');
                            } else if (chat.type === 'group') {
                              onStartGroupCall?.(chat.id, chat.name || 'Group', 'voice');
                            }
                          }}
                          className="flex items-center gap-3 w-full px-4 py-3 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                            <Phone size={16} className="text-emerald-400" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-medium">Аудиозвонок</p>
                            <p className="text-xs text-zinc-500">Только аудио</p>
                          </div>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* Меню */}
            <div className="relative" ref={topMenuRef}>
              <button
                onClick={() => setShowTopMenu(!showTopMenu)}
                className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white"
              >
                <MoreVertical size={18} />
              </button>
              <AnimatePresence>
                {showTopMenu && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: -5 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: -5 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-2 w-56 rounded-2xl glass-strong shadow-2xl z-[100] py-1.5 ring-1 ring-border/50 backdrop-blur-2xl"
                  >
                    <button
                      onClick={openSearch}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                    >
                      <Search size={16} />
                      {t('searchMessages')}
                    </button>
                    {chat.type === 'personal' && otherMember && (
                      <button
                        onClick={() => {
                          setShowTopMenu(false);
                          setProfileUserId(otherMember.user.id);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                      >
                        <UserPlus size={16} />
                        {t('userProfile')}
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (activeChat) {
                          const nowMuted = toggleMuteChat(activeChat);
                          setMuted(nowMuted);
                        }
                      }}
                      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                    >
                      {muted ? <Bell size={16} /> : <BellOff size={16} />}
                      {muted ? t('enableSound') : t('disableSound')}
                    </button>
                    {chat.type === 'group' && (
                      <button
                        onClick={() => {
                          setShowTopMenu(false);
                          setShowGroupSettings(true);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                      >
                        <Settings size={16} />
                        {t('groupSettings')}
                      </button>
                    )}
                    {chat.type === 'channel' && chat.members.some(m => m.user.id === user?.id && m.role === 'admin') && (
                      <button
                        onClick={() => {
                          setShowTopMenu(false);
                          setShowChannelStudio(true);
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                      >
                        <BarChart3 size={16} className="text-nexo-400" />
                        Студия канала
                      </button>
                    )}
                    {chat.type === 'channel' && (
                      <button
                        onClick={() => {
                          setShowTopMenu(false);
                          const shareUrl = `${window.location.origin}/channel/${chat.username}`;
                          navigator.clipboard.writeText(shareUrl);
                          alert('Ссылка скопирована в буфер обмена!');
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                          <polyline points="16 6 12 2 8 6"/>
                          <line x1="12" y1="2" x2="12" y2="15"/>
                        </svg>
                        Поделиться каналом
                      </button>
                    )}
                    {chat.type === 'channel' && chat.members.some(m => m.user.id === user?.id && m.role === 'admin') && (
                      <button
                        onClick={async () => {
                          setShowTopMenu(false);
                          if (!confirm('Вы уверены, что хотите удалить канал? Это действие нельзя отменить, канал будет удален у всех подписчиков.')) return;
                          try {
                            await api.deleteChat(activeChat);
                            useChatStore.getState().removeChat(activeChat);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={16} />
                        Удалить канал
                      </button>
                    )}
                    {chat.type === 'channel' && !chat.members.some(m => m.user.id === user?.id && m.role === 'admin') && (
                      <button
                        onClick={async () => {
                          setShowTopMenu(false);
                          try {
                            await api.deleteChat(activeChat);
                            useChatStore.getState().removeChat(activeChat);
                          } catch (e) {
                            console.error(e);
                          }
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                      >
                        <UserMinus size={16} />
                        {t('leaveChannel')}
                      </button>
                    )}
                    {chat.type !== 'channel' && chat.type !== 'favorites' && (
                      <>
                        <div className="border-t border-border my-1" />
                        <button
                          onClick={() => {
                            setShowTopMenu(false);
                            if (activeChat) {
                              setConfirmAction({
                                message: t('clearChatConfirm'),
                                action: async () => {
                                  try {
                                    await api.clearChat(activeChat);
                                    useChatStore.getState().clearMessages(activeChat);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                },
                              });
                            }
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                        >
                          <Eraser size={16} />
                          {t('clearChat')}
                        </button>
                        <button
                          onClick={() => {
                            setShowTopMenu(false);
                            if (activeChat) {
                              setConfirmAction({
                                message: t('deleteChatConfirm'),
                                action: async () => {
                                  try {
                                    await api.deleteChat(activeChat);
                                    useChatStore.getState().removeChat(activeChat);
                                  } catch (e) {
                                    console.error(e);
                                  }
                                },
                              });
                            }
                          }}
                          className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 size={16} />
                          {t('deleteChat')}
                        </button>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}

      {/* Результаты поиска */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="absolute top-[60px] sm:top-[76px] left-0 right-0 z-20 max-h-[300px] overflow-y-auto bg-[#09090b]/95 backdrop-blur-xl border-b border-border"
          >
            {isSearching ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-zinc-400">Поиск...</p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-zinc-400">
                  {searchText.trim() ? 'Ничего не найдено' : 'Введите текст для поиска'}
                </p>
              </div>
            ) : (
              searchResults.map((msg, idx) => (
                <div
                  key={msg.id}
                  className="px-4 py-3 hover:bg-white/5 cursor-pointer border-b border-white/5 last:border-0"
                  onClick={() => {
                    // Scroll to message
                    const el = document.getElementById(`msg-${msg.id}`);
                    if (el) {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      el.classList.add('bg-nexo-500/20');
                      setTimeout(() => el.classList.remove('bg-nexo-500/20'), 2000);
                    }
                    setShowSearch(false);
                    setSearchText('');
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-nexo-400">
                      {msg.sender?.displayName || msg.sender?.username}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {new Date(msg.createdAt).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                  <p className="text-sm text-zinc-300 line-clamp-2">
                    {msg.content}
                  </p>
                  {idx < searchResults.length - 1 && (
                    <div className="mt-2 h-px bg-white/5" />
                  )}
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Закреплённое сообщение */}
      {/* Active group call banner */}
      {chat?.type === 'group' && activeGroupCallParticipants.length > 0 && (
        <button
          onClick={() => onStartGroupCall?.(chat.id, chat.name || 'Group', 'voice')}
          className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors text-left w-full flex-shrink-0"
        >
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Phone size={14} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-emerald-400">{t('activeCall')}</p>
            <p className="text-sm text-zinc-300">{activeGroupCallParticipants.length} {t('participants')}</p>
          </div>
          <span className="text-xs text-emerald-400 font-medium px-3 py-1 rounded-full bg-emerald-500/20">{t('joinCall')}</span>
        </button>
      )}

      {pinnedMsg && (
        <button
          onClick={() => {
            const el = document.getElementById(`msg-${pinnedMsg.id}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('bg-nexo-500/20');
              setTimeout(() => el.classList.remove('bg-nexo-500/20'), 2000);
            }
          }}
          className="flex items-center gap-3 px-4 py-2 border-b border-border bg-[#09090b]/60 hover:bg-surface-hover transition-colors text-left w-full flex-shrink-0"
        >
          <Pin size={16} className="text-nexo-400 flex-shrink-0 rotate-45" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-nexo-400">{t('pinnedMessage')}</p>
            <p className="text-sm text-zinc-300 truncate">
              {pinnedMsg.content || (pinnedMsg.media?.length > 0 ? t('media') : '...')}
            </p>
          </div>
          <X
            size={16}
            className="text-zinc-500 hover:text-white flex-shrink-0 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              const socket = getSocket();
              if (socket && activeChat) {
                socket.emit('unpin_message', { messageId: pinnedMsg.id, chatId: activeChat });
              }
            }}
          />
        </button>
      )}

      {/* Сообщения */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-2 relative z-0 min-h-0"
      >
        {isLoadingMessages ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-nexo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : chatMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-zinc-500">{t('noMessages')}</p>
          </div>
        ) : (
          <div className="space-y-1 max-w-3xl mx-auto">
            {chatMessages.map((msg, i) => {
              const prevMsg = i > 0 ? chatMessages[i - 1] : null;
              const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;
              const showDate =
                !prevMsg ||
                new Date(msg.createdAt).toDateString() !== new Date(prevMsg.createdAt).toDateString();

              // Format date like Telegram: "5 апреля", "8 апреля"
              const formatDateSeparator = (date: Date) => {
                const today = new Date();
                const yesterday = new Date(today);
                yesterday.setDate(yesterday.getDate() - 1);

                if (date.toDateString() === today.toDateString()) {
                  return t('today');
                }
                if (date.toDateString() === yesterday.toDateString()) {
                  return t('yesterday');
                }

                return date.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US', {
                  day: 'numeric',
                  month: 'long',
                });
              };

              return (
                <div key={msg.id} id={`msg-${msg.id}`} className="transition-colors duration-500">
                  {showDate && (
                    <div className="flex justify-center my-4 select-none sticky top-0 z-10">
                      <span className="px-3 py-1 rounded-full text-xs text-zinc-400 bg-surface-secondary/80 backdrop-blur-sm shadow-sm select-none">
                        {formatDateSeparator(new Date(msg.createdAt))}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    isMine={msg.senderId === user?.id}
                    showAvatar={showAvatar}
                    onViewProfile={(userId) => setProfileUserId(userId)}
                    selectionMode={selectionMode}
                    isSelected={selectedMessages.has(msg.id)}
                    onToggleSelect={handleToggleSelect}
                    onStartSelectionMode={handleStartSelection}
                  />
                </div>
              );
            })}
            <div ref={messagesEndRef} className="h-4" /> {/* Empty spacer for the bottom scroll boundary */}
          </div>
        )}
      </div>

      {/* Кнопка прокрутки вниз */}
      <AnimatePresence>
        {showScrollDown && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => scrollToBottom()}
            className="absolute bottom-24 right-6 w-11 h-11 rounded-full bg-surface-tertiary/90 backdrop-blur-md border border-border shadow-2xl flex items-center justify-center text-zinc-400 hover:text-white hover:bg-surface-hover hover:scale-105 transition-all z-10"
          >
            <ArrowDown size={20} />
            {unreadCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center shadow-lg border-2 border-surface-secondary"
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </motion.span>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Typing индикатор - только не в каналах */}
      {showTypingIndicator && (
        <div className="px-4 pb-1 flex-shrink-0">
          <TypingIndicator />
        </div>
      )}

      {/* Ввод сообщения - только для тех кто может писать */}
      {(!chat || chat.type !== 'channel' || chat.members.some(m => m.user.id === user?.id && m.role === 'admin')) && (
        <div className="flex-shrink-0">
          <MessageInput chatId={activeChat} />
        </div>
      )}

      {/* Профиль пользователя */}
      <AnimatePresence>
        {profileUserId && (
          <UserProfile
            userId={profileUserId}
            chatId={activeChat || undefined}
            onClose={() => setProfileUserId(null)}
            isSelf={profileUserId === user?.id}
          />
        )}
      </AnimatePresence>

      {/* Настройки группы */}
      <AnimatePresence>
        {showGroupSettings && chat && chat.type === 'group' && (
          <GroupSettings
            chat={chat}
            onClose={() => setShowGroupSettings(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showForwardModal && (
          <ForwardModal
            onClose={() => setShowForwardModal(false)}
            onForward={handleForward}
          />
        )}
      </AnimatePresence>

      <ConfirmModal
        open={!!confirmAction}
        message={confirmAction?.message || ''}
        onConfirm={() => {
          confirmAction?.action();
          setConfirmAction(null);
        }}
        onCancel={() => setConfirmAction(null)}
      />

      <AnimatePresence>
        {showChannelProfile && (
          <ChannelProfile
            channelId={activeChat!}
            onClose={() => setShowChannelProfile(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChannelStudio && (
          <ChannelStudio
            channelId={activeChat!}
            onClose={() => setShowChannelStudio(false)}
          />
        )}
      </AnimatePresence>

      {/* Thread View */}
      <AnimatePresence>
        {activeThreadId && (
          <ThreadView
            threadId={activeThreadId}
            chatId={activeChat!}
            onClose={() => setActiveThreadId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
