import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../stores/chatStore';
import { useAuthStore } from '../stores/authStore';
import { getSocket, disconnectSocket } from '../lib/socket';
import { api } from '../lib/api';
import { playNotificationSound, isChatMuted } from '../lib/sounds';
import { useLang } from '../lib/i18n';
import type { Message, UserBasic, CallInfo } from '../lib/types';
import { Send, Check, ArrowLeft, Phone, MessageSquare } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import ChatView from '../components/ChatView';
import CallModal from '../components/CallModal';
import GroupCallModal from '../components/GroupCallModal';
import NexoAIPage from '../pages/NexoAIPage';
import FriendsPage from '../pages/FriendsPage';
import { initOfflineDB, cacheChats, getCachedChats, syncPendingActions } from '../lib/offlineCache';
import { useSettingsStore } from '../stores/settingsStore';

export default function ChatPage() {
  const {
    loadChats,
    addMessage,
    updateMessage,
    removeMessage,
    removeMessages,
    hideMessages,
    addReaction,
    removeReaction,
    markRead,
    addTypingUser,
    removeTypingUser,
    updateUserOnlineStatus,
    setPinnedMessage,
    removePinnedMessage,
    clearStore,
    activeChat,
  } = useChatStore();
  const { user } = useAuthStore();
  const initialized = useRef(false);

  // Call state
  const [callOpen, setCallOpen] = useState(false);
  const [callTarget, setCallTarget] = useState<UserBasic | null>(null);
  const [callType, setCallType] = useState<'voice' | 'video'>('voice');
  const [incomingCall, setIncomingCall] = useState<CallInfo | null>(null);
  const [callSessionId, setCallSessionId] = useState(0);
  const [deliveryNotification, setDeliveryNotification] = useState<string | null>(null);
  const deliveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [incomingNotif, setIncomingNotif] = useState<{ name: string; text: string } | null>(null);
  const incomingNotifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group call state
  const [groupCallOpen, setGroupCallOpen] = useState(false);
  const [groupCallChatId, setGroupCallChatId] = useState('');
  const [groupCallChatName, setGroupCallChatName] = useState('');
  const [groupCallType, setGroupCallType] = useState<'voice' | 'video'>('voice');
  const [groupCallSessionId, setGroupCallSessionId] = useState(0);

  const { t } = useLang();

  // Nexo AI state
  const [showAI, setShowAI] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false); // Sidebar state - скрыт по умолчанию

  // Определяем мобильное устройство
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // State for call restore confirmation
  const [showCallRestoreConfirm, setShowCallRestoreConfirm] = useState(false);
  const [pendingCallData, setPendingCallData] = useState<{ targetUser: UserBasic; type: 'voice' | 'video' } | null>(null);
  const [pendingGroupCallData, setPendingGroupCallData] = useState<{ chatId: string; chatName: string; type: 'voice' | 'video' } | null>(null);

  // Restore call state from sessionStorage on mount
  useEffect(() => {
    const savedCall = sessionStorage.getItem('nexo_active_call');
    if (savedCall) {
      try {
        const { targetUser, type } = JSON.parse(savedCall);
        if (targetUser && type) {
          setPendingCallData({ targetUser, type });
          setShowCallRestoreConfirm(true);
        }
      } catch (e) {
        console.error('Failed to restore call state:', e);
        sessionStorage.removeItem('nexo_active_call');
      }
    }
    
    const savedGroupCall = sessionStorage.getItem('nexo_active_group_call');
    if (savedGroupCall) {
      try {
        const { chatId, chatName, type } = JSON.parse(savedGroupCall);
        if (chatId && chatName && type) {
          setPendingGroupCallData({ chatId, chatName, type });
          setShowCallRestoreConfirm(true);
        }
      } catch (e) {
        console.error('Failed to restore group call state:', e);
        sessionStorage.removeItem('nexo_active_group_call');
      }
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    
    // Initialize offline DB and sync settings
    (async () => {
      try {
        await initOfflineDB();
        useSettingsStore.getState().syncFromServer();
      } catch (e) {
        console.warn('[Offline] Init failed:', e);
      }
    })();
    
    loadChats();

    // Sync pending offline actions when online
    if (navigator.onLine) {
      setTimeout(() => syncPendingActions(api), 3000);
    }
    (async () => {
      try {
        // Check if permissions were already granted
        const audioPerm = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        const videoPerm = await navigator.permissions.query({ name: 'camera' as PermissionName });
        
        if (audioPerm.state !== 'granted' || videoPerm.state !== 'granted') {
          // Request permissions silently
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          stream.getTracks().forEach(t => t.stop()); // Stop immediately, just to get permission
        }
      } catch {
        // Permissions not supported or denied - will be requested when needed
      }
    })();

    // Restore active chat from localStorage ONLY if it exists in current chats
    const savedChatId = localStorage.getItem('nexo_active_chat');
    if (savedChatId) {
      // Wait for chats to load first, then load messages
      setTimeout(() => {
        const currentChats = useChatStore.getState().chats;
        const chatExists = currentChats.some(c => c.id === savedChatId);
        if (chatExists) {
          useChatStore.getState().setActiveChat(savedChatId);
          // Load messages for this chat
          useChatStore.getState().loadMessages(savedChatId);
        } else {
          // Chat doesn't exist anymore, clear from localStorage
          localStorage.removeItem('nexo_active_chat');
        }
      }, 1000);
    }

    // Handle channel/user join from URL (e.g., /?channel=username or /?user=username)
    const urlParams = new URLSearchParams(window.location.search);
    const channelUsername = urlParams.get('channel');
    const userUsername = urlParams.get('user');
    
    if (channelUsername) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => {
        handleJoinChannel(channelUsername).catch((err) => {
          console.error('Channel join failed:', err);
        });
      }, 1000);
    } else if (userUsername) {
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => {
        handleOpenChatByUsername(userUsername).catch((err) => {
          console.error('User chat failed:', err);
        });
      }, 1000);
    }

    // Handle incoming call from notification click (e.g., /?call_action=incoming&callerId=xxx&callType=voice)
    const callAction = urlParams.get('call_action');
    const callerId = urlParams.get('callerId');
    const callTypeParam = urlParams.get('callType');

    if (callAction === 'incoming' && callerId) {
      window.history.replaceState({}, '', window.location.pathname);
      // Server will send call_incoming event, just wait for it
      // The socket handler will open the call modal automatically
    }
    
    // Listen for smooth username clicks (no page reload)
    const handleOpenChannel = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.channel) {
        const channel = customEvent.detail.channel;
        const store = useChatStore.getState();
        store.addChat(channel);
        setTimeout(() => {
          store.setActiveChat(channel.id);
          store.loadMessages(channel.id);
        }, 100);
      }
    };
    
    const handleOpenChat = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.user) {
        const user = customEvent.detail.user;
        const store = useChatStore.getState();
        // Find or create chat
        const existingChat = store.chats.find(c => 
          c.type === 'personal' && c.members.some(m => m.user.id === user.id)
        );
        if (existingChat) {
          store.setActiveChat(existingChat.id);
          store.loadMessages(existingChat.id);
        } else {
          api.createPersonalChat(user.id).then((chat) => {
            store.addChat(chat);
            store.setActiveChat(chat.id);
            store.loadMessages(chat.id);
          });
        }
      }
    };
    
    window.addEventListener('open-channel-by-username', handleOpenChannel);
    window.addEventListener('open-chat-by-username', handleOpenChat);
    window.addEventListener('toggle-sidebar', () => setShowSidebar(!showSidebar));
    
    return () => {
      window.removeEventListener('open-channel-by-username', handleOpenChannel);
      window.removeEventListener('open-chat-by-username', handleOpenChat);
      window.removeEventListener('toggle-sidebar', () => setShowSidebar(!showSidebar));
    };
  }, [loadChats, showSidebar]);

  const handleJoinChannel = async (username: string) => {
    try {
      const channel = await api.joinChannel(username);
      if (channel) {
        const store = useChatStore.getState();
        store.addChat(channel);
        setTimeout(() => {
          store.setActiveChat(channel.id);
        }, 100);
      }
    } catch (e) {
      console.error('Failed to join channel:', e);
    }
  };

  const handleOpenChatByUsername = async (username: string) => {
    try {
      const users = await api.searchUsers(username);
      const user = users.find(u => u.username === username);
      if (user) {
        const existingChat = useChatStore.getState().chats.find(c =>
          c.type === 'personal' && c.members.some(m => m.user.id === user.id)
        );
        if (existingChat) {
          useChatStore.getState().setActiveChat(existingChat.id);
        } else {
          const chat = await api.createPersonalChat(user.id);
          useChatStore.getState().addChat(chat);
          useChatStore.getState().setActiveChat(chat.id);
        }
      }
    } catch (e) {
      console.error('Failed to open chat with user:', e);
    }
  };

  // Handle chat selection on mobile — sidebar всегда виден на мобилках
  // ChatView показывается поверх когда activeChat установлен

  // Save active chat to localStorage
  useEffect(() => {
    if (activeChat) {
      localStorage.setItem('nexo_active_chat', activeChat);
    } else {
      localStorage.removeItem('nexo_active_chat');
    }
  }, [activeChat]);

  // Обработка закрытия вкладки — отправить disconnect
  useEffect(() => {
    const handleBeforeUnload = () => {
      const socket = getSocket();
      if (socket) {
        socket.disconnect();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.on('new_message', async (message: Message) => {
      // If this chat isn't in our store yet (e.g. someone just created it and sent a message),
      // fetch chats so the new chat appears in the sidebar immediately
      const { chats } = useChatStore.getState();
      if (!chats.some(c => c.id === message.chatId)) {
        try {
          const allChats = await api.getChats();
          const newChat = allChats.find(c => c.id === message.chatId);
          if (newChat) {
            // Reset unreadCount to 0 because addMessage below will increment it by 1
            useChatStore.getState().addChat({ ...newChat, unreadCount: 0 });
          }
        } catch (e) {
          console.error('Failed to fetch new chat:', e);
        }
      }
      addMessage(message);

      // Show in-app toast for messages from others
      if (message.senderId !== user?.id && !isChatMuted(message.chatId)) {
        const senderName = message.sender?.displayName || message.sender?.username || 'Кто-то';
        const preview = message.content || (message.type === 'voice' ? '🎙️ Голосовое' : message.type === 'image' ? '🖼️ Фото' : message.type === 'video' ? '🎥 Видео' : '📎 Файл');
        setIncomingNotif({ name: senderName, text: preview });
        if (incomingNotifTimer.current) clearTimeout(incomingNotifTimer.current);
        incomingNotifTimer.current = setTimeout(() => setIncomingNotif(null), 4000);
        playNotificationSound();
      }
    });

    socket.on('scheduled_delivered', async (message: Message & { _recipientName?: string; _deliveredAt?: string }) => {
      // If chat unknown, fetch it first
      const { chats } = useChatStore.getState();
      if (!chats.some(c => c.id === message.chatId)) {
        try {
          const allChats = await api.getChats();
          const newChat = allChats.find(c => c.id === message.chatId);
          if (newChat) useChatStore.getState().addChat(newChat);
        } catch (_) { /* ignore */ }
      }
      // A scheduled message was delivered: update it in store (remove scheduledAt)
      updateMessage({ ...message, scheduledAt: null });

      // Show delivery notification to the sender
      if (message.senderId === user?.id && message._recipientName) {
        const time = message._deliveredAt
          ? new Date(message._deliveredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        const notifText = `${useLang.getState().t('scheduledDelivered')} ${message._recipientName} ${useLang.getState().t('scheduledDeliveredAt')} ${time}`;
        setDeliveryNotification(notifText);
        if (deliveryTimerRef.current) clearTimeout(deliveryTimerRef.current);
        deliveryTimerRef.current = setTimeout(() => setDeliveryNotification(null), 5000);
      }

      // Notify others with sound
      if (message.senderId !== user?.id && !isChatMuted(message.chatId)) {
        playNotificationSound();
      }
    });

    socket.on('message_edited', (message: Message) => {
      updateMessage(message);
    });

    socket.on('message_deleted', (data: { messageId: string; chatId: string }) => {
      removeMessage(data.messageId, data.chatId);
    });

    socket.on('messages_deleted', (data: { messageIds: string[]; chatId: string }) => {
      removeMessages(data.messageIds, data.chatId);
    });

    socket.on('messages_hidden', (data: { messageIds: string[]; chatId: string }) => {
      hideMessages(data.messageIds, data.chatId);
    });

    socket.on('reaction_added', (data: { messageId: string; chatId: string; userId: string; username: string; emoji: string }) => {
      addReaction(data.messageId, data.chatId, data.userId, data.username, data.emoji);
    });

    socket.on('reaction_removed', (data: { messageId: string; chatId: string; userId: string; emoji: string }) => {
      removeReaction(data.messageId, data.chatId, data.userId, data.emoji);
    });

    socket.on('messages_read', (data: { chatId: string; userId: string; messageIds: string[] }) => {
      markRead(data.chatId, data.userId, data.messageIds);
    });

    socket.on('user_typing', (data: { chatId: string; userId: string }) => {
      if (data.userId !== user?.id) {
        addTypingUser(data.chatId, data.userId);
        setTimeout(() => removeTypingUser(data.chatId, data.userId), 3000);
      }
    });

    socket.on('user_stopped_typing', (data: { chatId: string; userId: string }) => {
      removeTypingUser(data.chatId, data.userId);
    });

    socket.on('user_online', (data: { userId: string }) => {
      updateUserOnlineStatus(data.userId, true);
    });

    socket.on('user_offline', (data: { userId: string; lastSeen?: string }) => {
      updateUserOnlineStatus(data.userId, false, data.lastSeen);
    });

    socket.on('message_pinned', (data: { chatId: string; message: Message }) => {
      setPinnedMessage(data.chatId, data.message);
    });

    socket.on('message_unpinned', (data: { chatId: string; messageId: string; newPinnedMessage: Message | null }) => {
      removePinnedMessage(data.chatId, data.messageId, data.newPinnedMessage);
    });

    socket.on('call_incoming', async (data: CallInfo) => {
      // Use callerInfo from server if available, otherwise look up from chats
      let callerInfo: UserBasic | null = data.callerInfo || null;
      if (!callerInfo) {
        const { chats } = useChatStore.getState();
        for (const chat of chats) {
          const member = chat.members.find((m) => m.user.id === data.from);
          if (member) {
            callerInfo = member.user;
            break;
          }
        }
      }
      setCallTarget(null); // Clear any previous outgoing target
      setIncomingCall({
        from: data.from,
        offer: data.offer,
        callType: data.callType,
        chatId: data.chatId,
        callerInfo,
      });
      setCallType(data.callType);
      setCallSessionId(id => id + 1);
      setCallOpen(true);
    });

    return () => {
      socket.off('new_message');
      socket.off('scheduled_delivered');
      socket.off('message_edited');
      socket.off('message_deleted');
      socket.off('messages_deleted');
      socket.off('messages_hidden');
      socket.off('reaction_added');
      socket.off('reaction_removed');
      socket.off('messages_read');
      socket.off('user_typing');
      socket.off('user_stopped_typing');
      socket.off('user_online');
      socket.off('user_offline');
      socket.off('message_pinned');
      socket.off('message_unpinned');
      socket.off('call_incoming');
    };
  }, [user?.id]);

  const handleStartCall = (targetUser: UserBasic, type: 'voice' | 'video') => {
    setCallTarget(targetUser);
    setCallType(type);
    setIncomingCall(null);
    setCallSessionId(id => id + 1);
    setCallOpen(true);
    // Save call state to sessionStorage
    sessionStorage.setItem('nexo_active_call', JSON.stringify({ targetUser, type }));
  };

  const handleStartGroupCall = (chatId: string, chatName: string, type: 'voice' | 'video') => {
    setGroupCallChatId(chatId);
    setGroupCallChatName(chatName);
    setGroupCallType(type);
    setGroupCallSessionId(id => id + 1);
    setGroupCallOpen(true);
    // Save group call state to sessionStorage
    sessionStorage.setItem('nexo_active_group_call', JSON.stringify({ chatId, chatName, type }));
  };

  const handleCloseCall = () => {
    setCallOpen(false);
    setCallTarget(null);
    setIncomingCall(null);
    // Clear call state from sessionStorage
    sessionStorage.removeItem('nexo_active_call');
  };

  const handleCloseGroupCall = () => {
    setGroupCallOpen(false);
    // Clear group call state from sessionStorage
    sessionStorage.removeItem('nexo_active_group_call');
  };

  const handleRestoreCall = () => {
    if (pendingCallData) {
      setCallTarget(pendingCallData.targetUser);
      setCallType(pendingCallData.type);
      setCallOpen(true);
      setPendingCallData(null);
    }
    if (pendingGroupCallData) {
      setGroupCallChatId(pendingGroupCallData.chatId);
      setGroupCallChatName(pendingGroupCallData.chatName);
      setGroupCallType(pendingGroupCallData.type);
      setGroupCallOpen(true);
      setPendingGroupCallData(null);
    }
    setShowCallRestoreConfirm(false);
  };

  const handleDiscardCall = () => {
    sessionStorage.removeItem('nexo_active_call');
    sessionStorage.removeItem('nexo_active_group_call');
    setPendingCallData(null);
    setPendingGroupCallData(null);
    setShowCallRestoreConfirm(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="h-full w-full flex flex-col sm:flex-row bg-surface gap-0 overflow-hidden"
    >
      {/* Sidebar — всегда скрыт по умолчанию, открывается по кнопке */}
      <div className={`${showSidebar ? 'flex' : 'hidden'} sm:flex w-full sm:w-[380px] flex-shrink-0 min-w-0 ${showAI && !isMobile ? 'hidden' : ''}`}>
        <Sidebar onOpenAI={() => setShowAI(true)} onOpenFriends={() => setShowFriends(true)} onToggleSidebar={() => setShowSidebar(!showSidebar)} />
      </div>

      {/* ChatView — на мобилках поверх когда activeChat, на ПК всегда рядом */}
      <div className={`${isMobile && !activeChat ? 'hidden' : 'flex'} sm:flex flex-1 min-w-0 relative overflow-hidden`}>
        {/* Back button for mobile — возвращает к sidebar */}
        {isMobile && (
          <button
            onClick={() => useChatStore.getState().setActiveChat(null)}
            className="absolute left-3 top-3 z-30 p-2 rounded-lg bg-surface-secondary/90 backdrop-blur border border-border text-white hover:bg-surface-hover transition-colors shadow-lg"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="flex-1 w-full h-full min-h-0 overflow-hidden">
          <ChatView onStartCall={handleStartCall} onStartGroupCall={handleStartGroupCall} />
        </div>
      </div>

      {/* ====== NEXO AI PANEL ====== */}
      <AnimatePresence>
        {showAI && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={`fixed inset-0 z-[150] ${
              isMobile ? 'bg-[#0a0a0f]' : 'right-0 top-0 bottom-0 w-[480px] bg-[#0a0a0f] border-l border-white/10 shadow-2xl'
            }`}
          >
            <NexoAIPage onClose={() => setShowAI(false)} isFullMode={isMobile} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Friends Page */}
      <AnimatePresence>
        {showFriends && (
          <motion.div
            initial={{ opacity: 0, x: isMobile ? 0 : 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isMobile ? 0 : 40 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={`fixed inset-0 z-[150] sm:z-[140] ${
              isMobile
                ? ''
                : 'right-0 top-0 bottom-0 w-[480px]'
            }`}
          >
            <div className={`h-full bg-[#0a0a0f] ${isMobile ? '' : 'border-l border-white/10 shadow-2xl'}`}>
              <FriendsPage onClose={() => setShowFriends(false)} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <CallModal
        key={callSessionId}
        isOpen={callOpen}
        onClose={handleCloseCall}
        targetUser={callTarget}
        callType={callType}
        incoming={incomingCall}
      />
      <GroupCallModal
        key={`gc-${groupCallSessionId}`}
        isOpen={groupCallOpen}
        onClose={handleCloseGroupCall}
        chatId={groupCallChatId}
        chatName={groupCallChatName}
        callType={groupCallType}
      />

      {/* Scheduled message delivery notification */}
      <AnimatePresence>
        {deliveryNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl bg-surface-secondary shadow-2xl border border-border flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Send size={14} className="text-emerald-400" />
            </div>
            <span className="text-sm text-zinc-200">{deliveryNotification}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Incoming message toast notification */}
      <AnimatePresence>
        {incomingNotif && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-2xl bg-surface-secondary/95 backdrop-blur-xl shadow-2xl border border-nexo-500/30 flex items-center gap-3 max-w-sm"
            onClick={() => setIncomingNotif(null)}
          >
            <div className="w-9 h-9 rounded-full bg-nexo-500/20 flex items-center justify-center flex-shrink-0">
              <MessageSquare size={15} className="text-nexo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-nexo-400 truncate">{incomingNotif.name}</p>
              <p className="text-sm text-zinc-200 truncate">{incomingNotif.text}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Call restore confirmation modal */}
      <AnimatePresence>
        {showCallRestoreConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleDiscardCall}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-md rounded-2xl glass-strong border border-white/10 p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-nexo-500/20 flex items-center justify-center">
                  <Phone className="w-5 h-5 text-nexo-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">Восстановить звонок?</h3>
              </div>
              <p className="text-sm text-zinc-400 mb-6">
                У вас был активный звонок при закрытии вкладки. Хотите вернуться в него?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleRestoreCall}
                  className="flex-1 py-2.5 rounded-xl bg-nexo-500 hover:bg-nexo-600 text-white text-sm font-medium transition-colors"
                >
                  Вернуться в звонок
                </button>
                <button
                  onClick={handleDiscardCall}
                  className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
                >
                  Отменить
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
