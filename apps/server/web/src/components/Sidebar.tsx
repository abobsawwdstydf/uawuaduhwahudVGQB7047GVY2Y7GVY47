import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Plus,
  Menu,
  X,
  MessageSquare,
  Users,
  Sparkles,
  Settings,
  User,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { useLang } from '../lib/i18n';
import { api } from '../lib/api';
import { normalizeMediaUrl } from '../lib/mediaUrl';
import Avatar from './Avatar';
import { StoryGroup, Chat } from '../lib/types';
import ChatListItem from './ChatListItem';
import NewChatModal from './NewChatModal';
import UserProfile from './UserProfile';
import SideMenu from './SideMenu';
import StoryViewer, { CreateStoryModal } from './StoryViewer';

// Типы навигации
type NavTab = 'chats' | 'friends' | 'settings' | 'profile';

interface SidebarProps {
  onOpenAI: () => void;
  onOpenFriends: () => void;
  onToggleSidebar?: () => void;
}

/**
 * Боковая кнопка навигации (ПК)
 * Иконка + tooltip с текстом справа при hover
 */
function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: typeof MessageSquare;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <div className="relative group">
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`relative flex items-center justify-center w-12 h-12 rounded-2xl transition-all duration-200 ${
          active ? 'glass-tab-active' : 'hover:bg-white/5'
        }`}
      >
        {/* Иконка */}
        <Icon size={20} className={active ? 'text-nexo-400' : 'text-zinc-400 hover:text-white transition-colors'} />

        {/* Бейдж */}
        {badge && badge > 0 && (
          <div className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-nexo-500 flex items-center justify-center">
            <span className="text-[9px] font-bold text-white">{badge > 99 ? '99+' : badge}</span>
          </div>
        )}
      </motion.button>

      {/* Tooltip — текст справа при hover */}
      <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-lg bg-zinc-800 border border-white/10 text-sm text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-50 shadow-xl pointer-events-none">
        {label}
        <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-zinc-800" />
      </div>
    </div>
  );
}
  );
}

export default function Sidebar({ onOpenAI, onOpenFriends, onToggleSidebar }: SidebarProps) {
  const { user } = useAuthStore();
  const { chats, activeChat, searchQuery, setSearchQuery, addChat, setActiveChat } = useChatStore();
  const { t } = useLang();
  const [showNewChat, setShowNewChat] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showSideMenu, setShowSideMenu] = useState(false);
  const [storyGroups, setStoryGroups] = useState<StoryGroup[]>([]);
  const [storyViewerIndex, setStoryViewerIndex] = useState<number | null>(null);
  const [showCreateStory, setShowCreateStory] = useState(false);
  const openingChatRef = useRef(false);

  // Навигация
  const [activeTab, setActiveTab] = useState<NavTab>('chats');
  const [isMobile, setIsMobile] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(false); // Always hidden by default

  // Результаты поиска
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [channelResults, setChannelResults] = useState<Chat[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  /** Определяем мобильное устройство */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /** Загрузка сторисов — ТОЛЬКО с сервера */
  const loadStories = () => {
    api.getStories()
      .then((stories) => {
        setStoryGroups(stories);
      })
      .catch(console.error);
  };

  /** Поиск */
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setChannelResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const [users, channels] = await Promise.all([
          api.searchUsers(searchQuery),
          api.searchChannels(searchQuery)
        ]);
        setSearchResults(users);
        setChannelResults(channels);
      } catch (e) {
        console.error('Search error:', e);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleJoinChannel = async (channel: Chat) => {
    try {
      const joined = await api.joinChannel(channel.username!);
      addChat(joined);
      setActiveChat(joined.id);
      setSearchQuery('');
    } catch (e) {
      console.error('Failed to join channel:', e);
    }
  };

  const handleOpenChatWithUser = async (userId: string) => {
    if (openingChatRef.current) return;
    openingChatRef.current = true;

    try {
      const store = useChatStore.getState();
      const existingChat = store.chats.find(c =>
        c.type === 'personal' && c.members.some(m => m.user.id === userId)
      );

      if (existingChat) {
        store.setActiveChat(existingChat.id);
        setSearchQuery('');
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
        const refreshedChats = store.chats;
        const stillExisting = refreshedChats.find(c =>
          c.type === 'personal' && c.members.some(m => m.user.id === userId)
        );

        if (stillExisting) {
          store.setActiveChat(stillExisting.id);
        } else {
          const chat = await api.createPersonalChat(userId);
          store.addChat(chat);
          store.setActiveChat(chat.id);
        }
        setSearchQuery('');
      }
    } catch (e) {
      console.error('Failed to open chat:', e);
    } finally {
      openingChatRef.current = false;
    }
  };

  const handleOpenChatFromStory = (userId: string) => {
    handleOpenChatWithUser(userId);
  };

  useEffect(() => {
    loadStories();
    const interval = setInterval(loadStories, 30000);
    return () => clearInterval(interval);
  }, []);

  /** Фильтрация чатов */
  const filteredChats = chats.filter((chat) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    if (chat.name?.toLowerCase().includes(q)) return true;
    return chat.members.some(
      (m) =>
        m.user.id !== user?.id &&
        (m.user.username.toLowerCase().includes(q) ||
          m.user.displayName.toLowerCase().includes(q))
    );
  }).sort((a, b) => {
    if (a.type === 'favorites') return -1;
    if (b.type === 'favorites') return 1;
    return 0;
  });

  /** Счётчик непрочитанных */
  const unreadCount = chats.reduce((acc, chat) => acc + (chat.unreadCount || 0), 0);

  /** Переключение вкладок */
  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    if (tab === 'chats') setSearchQuery('');
    if (tab === 'profile') setShowProfile(true);
    if (tab === 'settings') setShowSideMenu(true);
    if (tab === 'friends') onOpenFriends();
  };

  return (
    <>
      <div className="w-full sm:w-[380px] h-full flex bg-[#0a0a0f] sm:rounded-3xl overflow-hidden border border-white/5 relative z-10">

        {/* ====== БОКОВАЯ НАВИГАЦИЯ (ПК) ====== */}
        {!isMobile && isSidebarVisible && (
          <div className="w-[56px] glass-strong flex flex-col items-center py-3 gap-2 flex-shrink-0 z-20">
            {/* Логотип */}
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-nexo-500 to-purple-600 flex items-center justify-center mb-2">
              <img src="/logo.png" alt="Nexo" className="w-6 h-6 rounded-lg object-cover" />
            </div>

            <div className="w-8 h-px bg-white/10 my-1" />

            {/* Чаты */}
            <NavButton
              icon={MessageSquare}
              label="Чаты"
              active={activeTab === 'chats'}
              onClick={() => handleTabChange('chats')}
              badge={unreadCount}
            />

            {/* Новый чат */}
            <NavButton
              icon={Plus}
              label="Новый чат"
              active={false}
              onClick={() => setShowNewChat(true)}
            />

            {/* Nexo AI */}
            <NavButton
              icon={Sparkles}
              label="Nexo AI"
              active={false}
              onClick={onOpenAI}
            />

            <div className="flex-1" />

            {/* Настройки */}
            <NavButton
              icon={Settings}
              label="Настройки"
              active={activeTab === 'settings'}
              onClick={() => handleTabChange('settings')}
            />

            {/* Профиль */}
            <button
              onClick={() => handleTabChange('profile')}
              className="w-10 h-10 rounded-xl overflow-hidden hover:ring-2 hover:ring-nexo-500/50 transition-all"
            >
              {user?.avatar ? (
                <img src={normalizeMediaUrl(user.avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-nexo-500 to-purple-600 text-white text-sm font-bold">
                  {(user?.displayName || user?.username || '?')[0].toUpperCase()}
                </div>
              )}
            </button>
          </div>
        )}

        {/* ====== ОСНОВНОЙ КОНТЕНТ ====== */}
        <div className="flex-1 flex flex-col min-w-0">

          {/* Header */}
          <div className="relative h-[64px] px-4 flex items-center gap-3 flex-shrink-0 glass-strong">
            {/* Меню (ПК и мобилки) */}
            <button
              onClick={() => setShowSideMenu(true)}
              className="glass-btn w-10 h-10 rounded-xl text-zinc-300 hover:text-white flex-shrink-0"
              title="Меню"
            >
              <Menu size={18} />
            </button>

            {/* Заголовок */}
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="relative">
                <div className="absolute inset-0 bg-nexo-500/30 blur-xl rounded-xl" />
                <img src="/logo.png" alt="Nexo" className="relative w-7 h-7 rounded-xl object-cover" />
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent truncate">
                {activeTab === 'chats' && 'Nexo'}
                {activeTab === 'friends' && 'Друзья'}
                {activeTab === 'settings' && 'Настройки'}
              </h1>
            </div>
          </div>

          {/* Поиск */}
          <div className="relative px-3 py-2.5 flex-shrink-0">
            <div className="relative group">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-nexo-400 transition-colors pointer-events-none z-10" />
              <input
                type="text"
                placeholder={
                  activeTab === 'friends' ? 'Имя или @username' :
                  searchResults.length > 0 || channelResults.length > 0 ? 'Уточните запрос...' :
                  'Имя, @username или название канала'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8 py-2 rounded-xl text-sm text-white placeholder-zinc-500 glass-input focus:ring-1 focus:ring-nexo-500/30 transition-all"
              />
              {searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded-md flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                  title="Очистить"
                >
                  <X size={12} />
                </button>
              ) : isSearching ? (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <div className="w-3.5 h-3.5 border-2 border-nexo-400 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : null}
            </div>

            {/* Подсказка при поиске */}
            {searchQuery.trim() && (
              <div className="flex items-center justify-between mt-1.5 px-1">
                <span className="text-[10px] text-zinc-600">
                  {searchResults.length + channelResults.length > 0
                    ? `Найдено: ${searchResults.length} польз., ${channelResults.length} кан.`
                    : isSearching ? 'Ищем...' : 'Ничего не найдено'}
                </span>
              </div>
            )}
          </div>

          {/* Сторисы (только на вкладке чатов) */}
          {activeTab === 'chats' && (
            <div className="px-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                <button
                  onClick={() => setShowCreateStory(true)}
                  className="flex flex-col items-center gap-1 flex-shrink-0 group"
                >
                  <div className="w-14 h-14 rounded-full glass-btn group-hover:scale-105 transition-transform">
                    <Plus size={16} className="text-nexo-400" />
                  </div>
                  <span className="text-[10px] text-zinc-500 truncate w-14 text-center">{t('newStory')}</span>
                </button>

                {storyGroups.map((group, idx) => {
                  const avatarUrl = group.user.avatar ? normalizeMediaUrl(group.user.avatar) : null;
                  const isMine = group.user.id === user?.id;
                  return (
                    <button
                      key={group.user.id}
                      onClick={() => setStoryViewerIndex(idx)}
                      className="flex flex-col items-center gap-1 flex-shrink-0 group"
                    >
                      <div className={`w-14 h-14 rounded-full p-[2px] transition-transform group-hover:scale-105 ${
                        group.hasUnviewed
                          ? 'bg-gradient-to-tr from-nexo-400 via-purple-500 to-pink-500 shadow-lg shadow-nexo-500/20'
                          : isMine
                            ? 'bg-gradient-to-tr from-zinc-500 to-zinc-600'
                            : 'bg-zinc-700'
                      }`}>
                        <div className="w-full h-full rounded-full overflow-hidden border-2 border-[#0a0a0f]">
                          <Avatar
                            src={avatarUrl}
                            name={group.user.displayName || group.user.username}
                            size="lg"
                            className="w-full h-full"
                            isVerified={(group.user as any).isVerified}
                            verifiedBadgeUrl={(group.user as any).verifiedBadgeUrl}
                            verifiedBadgeType={(group.user as any).verifiedBadgeType}
                          />
                        </div>
                      </div>
                      <span className="text-[10px] text-zinc-400 truncate w-14 text-center">
                        {isMine ? t('myStory') : (group.user.displayName || group.user.username).split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Разделитель */}
          <div className="mx-4 h-px bg-white/5 flex-shrink-0" />

          {/* Контент вкладки */}
          <div className={`flex-1 overflow-y-auto relative ${isMobile ? 'pb-28' : 'pb-2'}`}>
            <AnimatePresence mode="wait">
              {activeTab === 'chats' && (
                <motion.div
                  key="chats"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {searchQuery.trim() ? (
                    /* Результаты поиска */
                    <div className="py-2">
                      {searchResults.length > 0 && (
                        <div className="mb-4">
                          <div className="px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
                            <MessageSquare size={10} />
                            Пользователи
                          </div>
                          <div className="space-y-0.5">
                            {searchResults.map((u) => (
                              <motion.button
                                key={u.id}
                                onClick={() => handleOpenChatWithUser(u.id)}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-white/5 transition-colors"
                              >
                                {u.avatar ? (
                                  <img src={u.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-nexo-500 to-purple-600 flex items-center justify-center text-white text-sm font-bold">
                                    {(u.displayName || u.username || '?')[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 text-left min-w-0">
                                  <p className="text-sm font-medium text-white truncate">{u.displayName || u.username}</p>
                                  <p className="text-xs text-zinc-500">@{u.username}</p>
                                </div>
                                <MessageSquare size={14} className="text-zinc-600" />
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      )}

                      {channelResults.length > 0 && (
                        <div className="mb-4">
                          <div className="px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                            Каналы
                          </div>
                          <div className="space-y-0.5">
                            {channelResults.map((channel) => (
                              <motion.button
                                key={channel.id}
                                onClick={() => handleJoinChannel(channel)}
                                whileHover={{ scale: 1.01 }}
                                whileTap={{ scale: 0.99 }}
                                className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-white/5 transition-colors"
                              >
                                {channel.avatar ? (
                                  <img src={channel.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                                ) : (
                                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white text-sm font-bold">
                                    {(channel.name || channel.username || '?')[0].toUpperCase()}
                                  </div>
                                )}
                                <div className="flex-1 text-left min-w-0">
                                  <p className="text-sm font-medium text-white truncate">{channel.name}</p>
                                  <p className="text-xs text-zinc-500">@{channel.username}</p>
                                </div>
                                <MessageSquare size={14} className="text-zinc-600" />
                              </motion.button>
                            ))}
                          </div>
                        </div>
                      )}

                      {searchResults.length === 0 && channelResults.length === 0 && !isSearching && (
                        <motion.div
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="flex flex-col items-center justify-center py-12 text-zinc-500 gap-3"
                        >
                          <div className="w-16 h-16 rounded-full glass-subtle flex items-center justify-center">
                            <Search size={24} className="opacity-50" />
                          </div>
                          <p className="text-sm">Ничего не найдено</p>
                        </motion.div>
                      )}

                      {isSearching && (
                        <div className="flex items-center justify-center py-12">
                          <div className="w-6 h-6 border-2 border-nexo-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                  ) : filteredChats.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 px-6"
                    >
                      <div className="w-20 h-20 rounded-full glass-subtle flex items-center justify-center">
                        <MessageSquare size={36} className="opacity-30" />
                      </div>
                      <p className="text-sm text-center">{t('noChats')}</p>
                    </motion.div>
                  ) : (
                    <div className="py-2">
                      {filteredChats.map((chat) => (
                        <ChatListItem key={chat.id} chat={chat} isActive={chat.id === activeChat} />
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'friends' && (
                <motion.div
                  key="friends"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4 px-6"
                >
                  <div className="w-20 h-20 rounded-full glass-subtle flex items-center justify-center">
                    <Users size={36} className="opacity-30" />
                  </div>
                  <p className="text-sm text-center font-medium">Друзья</p>
                  <p className="text-xs text-zinc-600 text-center">Управление друзьями через панель</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ====== НИЖНЯЯ НАВИГАЦИЯ (МОБИЛКИ) — FIXED, всегда внизу ====== */}
          {isMobile && (
            <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-2 pointer-events-none z-50">
              <div className="pointer-events-auto glass-strong rounded-[2rem] flex items-center justify-around px-3 py-2 max-w-sm mx-auto relative">
                {/* Чаты */}
                <button
                  onClick={() => handleTabChange('chats')}
                  className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors ${
                    activeTab === 'chats' ? 'text-nexo-400' : 'text-zinc-400'
                  }`}
                >
                  <div className="relative">
                    <MessageSquare size={22} />
                    {unreadCount > 0 && (
                      <div className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-nexo-500 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] font-medium">Чаты</span>
                </button>

                {/* Друзья */}
                <button
                  onClick={() => handleTabChange('friends')}
                  className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-colors ${
                    activeTab === 'friends' ? 'text-nexo-400' : 'text-zinc-400'
                  }`}
                >
                  <Users size={22} />
                  <span className="text-[10px]">Друзья</span>
                </button>

                {/* Новый чат — выступающая центральная кнопка */}
                <div className="relative -mt-8">
                  <button
                    onClick={() => setShowNewChat(true)}
                    className="w-16 h-16 rounded-2xl bg-gradient-to-br from-nexo-500 to-purple-600 flex items-center justify-center text-white shadow-xl shadow-nexo-500/40 hover:shadow-nexo-500/60 hover:scale-105 active:scale-95 transition-all duration-200"
                  >
                    <Plus size={28} />
                  </button>
                </div>

                {/* Nexo AI */}
                <button
                  onClick={onOpenAI}
                  className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl text-zinc-400 hover:text-nexo-400 transition-colors"
                >
                  <Sparkles size={22} />
                  <span className="text-[10px]">Nexo AI</span>
                </button>

                {/* Профиль с аватаркой - только аватарка без текста */}
                <button
                  onClick={() => setShowProfile(true)}
                  className="flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl transition-colors"
                >
                  <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-transparent hover:ring-nexo-500/50 transition-all">
                    {user?.avatar ? (
                      <img src={normalizeMediaUrl(user.avatar)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-nexo-500 to-purple-600 text-white text-xs font-bold">
                        {(user?.displayName || user?.username || '?')[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ====== МОДАЛКИ ====== */}
      <AnimatePresence>
        {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {showProfile && <UserProfile userId={user!.id} onClose={() => setShowProfile(false)} isSelf />}
      </AnimatePresence>
      <SideMenu
        isOpen={showSideMenu}
        onClose={() => setShowSideMenu(false)}
      />
      <AnimatePresence>
        {storyViewerIndex !== null && storyGroups.length > 0 && (
          <StoryViewer
            stories={storyGroups}
            initialUserIndex={storyViewerIndex}
            onClose={() => { setStoryViewerIndex(null); loadStories(); }}
            onRefresh={loadStories}
            onOpenChat={handleOpenChatFromStory}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showCreateStory && (
          <CreateStoryModal
            onClose={() => setShowCreateStory(false)}
            onCreated={loadStories}
          />
        )}
      </AnimatePresence>
    </>
  );
}
