import { useState, useRef, useEffect, memo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check,
  CheckCheck,
  Play,
  Pause,
  Download,
  FileText,
  Copy,
  Pencil,
  Trash2,
  Reply,
  Smile,
  MoreHorizontal,
  X,
  Volume2,
  Pin,
  Clock,
  Eye,
  Phone,
  PhoneMissed,
  Video,
  MapPin,
  BarChart3,
  MessageSquare,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import { getSocket } from '../lib/socket';
import { api } from '../lib/api';
import { useLang } from '../lib/i18n';
import { extractWaveform } from '../lib/utils';
import { normalizeMediaUrl } from '../lib/mediaUrl';
import { audioManager } from '../lib/audioManager';
import type { Message, MediaItem, Reaction, ChatMember } from '../lib/types';
import ImageLightbox from './ImageLightbox';
import VideoPlayer from './VideoPlayer';
import Avatar from './Avatar';
import YouTubePreview from './YouTubePreview';
import LinkEmbedPreview from './LinkEmbedPreview';
import CodeBlock from './CodeBlock';

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  showAvatar: boolean;
  onViewProfile?: (userId: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onStartSelectionMode?: (id: string) => void;
}

function MessageBubble({
  message,
  isMine,
  showAvatar,
  onViewProfile,
  selectionMode,
  isSelected,
  onToggleSelect,
  onStartSelectionMode
}: MessageBubbleProps) {
  const { user } = useAuthStore();
  const { setReplyTo, setEditingMessage, pinnedMessages, chats, messages } = useChatStore();
  const chatMessages = messages[message.chatId] || [];
  const chat = chats.find(c => c.id === message.chatId);
  const isChannel = chat?.type === 'channel';
  const isGroup = chat?.type === 'group';
  const isOwner = chat?.members.find(m => m.user.id === user?.id)?.role === 'owner';
  const canManageMessages = isChannel || isGroup ? isOwner : false;
  const { t, lang } = useLang();
  
  // For channels, show channel name instead of sender name
  const senderName = isChannel ? (chat?.name || chat?.username || 'Канал') : (message.sender?.displayName || message.sender?.username || '');
  const senderAvatar = isChannel ? chat?.avatar : message.sender?.avatar;
  const [showContext, setShowContext] = useState(false);
  const [contextPos, setContextPos] = useState({ x: 0, y: 0 });
  const [deleteMenuMode, setDeleteMenuMode] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showVideoPlayer, setShowVideoPlayer] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [waveformBars, setWaveformBars] = useState<number[] | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const speedMenuRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [quotedText, setQuotedText] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showCollapse, setShowCollapse] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Format call duration
  const formatCallDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Check if content is too long and needs collapsing
  useEffect(() => {
    if (contentRef.current) {
      const height = contentRef.current.scrollHeight;
      setShowCollapse(height > 300);
      if (height > 300) setIsCollapsed(true);
    }
  }, [message.content]);

  // Прочитано
  const isRead = message.readBy?.some((r) => r.userId !== user?.id);

  const timeStr = new Date(message.createdAt).toLocaleTimeString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Avoid triggering window listener instantly for other menus
    if (selectionMode) {
      onToggleSelect?.(message.id);
      return;
    }
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;

    // Check if text is selected inside this bubble
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && bubbleRef.current?.contains(selection?.anchorNode || null)) {
      setQuotedText(text);
    } else {
      setQuotedText(null);
    }

    const menuWidth = 208;
    const menuHeight = 350; // estimate
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;

    setContextPos({ x, y });
    setShowContext(true);
  };

  const handleCopy = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
    }
    setShowContext(false);
  };

  const handleReply = () => {
    setReplyTo({ ...message, quote: quotedText });
    setShowContext(false);
    setQuotedText(null);
  };

  const handleEdit = () => {
    setEditingMessage(message);
    setShowContext(false);
  };

  const handleDeleteForAll = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('delete_messages', {
        messageIds: [message.id],
        chatId: message.chatId,
        deleteForAll: true,
      });
    }
    setShowContext(false);
    setDeleteMenuMode(false);
  };

  const handleDeleteForMe = () => {
    const socket = getSocket();
    if (socket) {
      socket.emit('delete_messages', {
        messageIds: [message.id],
        chatId: message.chatId,
        deleteForAll: false,
      });
    }
    // Optimistic hide
    useChatStore.getState().hideMessages([message.id], message.chatId);
    setShowContext(false);
    setDeleteMenuMode(false);
  };

  // Имя собеседника для кнопки «Удалить также для ...»
  const chatForDelete = chats.find(c => c.id === message.chatId);
  const otherMemberName = chatForDelete?.type === 'personal'
    ? chatForDelete.members.find(m => m.user.id !== user?.id)?.user.displayName
      || chatForDelete.members.find(m => m.user.id !== user?.id)?.user.username
      || ''
    : '';

  const isPinned = pinnedMessages[message.chatId]?.id === message.id;

  const handlePin = () => {
    const socket = getSocket();
    if (socket) {
      if (isPinned) {
        socket.emit('unpin_message', { messageId: message.id, chatId: message.chatId });
      } else {
        socket.emit('pin_message', { messageId: message.id, chatId: message.chatId });
      }
    }
    setShowContext(false);
  };

  const handleCreateThread = () => {
    // Thread functionality removed per user request
    setShowContext(false);
  };

  const handleReaction = (emoji: string) => {
    const socket = getSocket();
    if (socket) {
      const existingReaction = message.reactions?.find(
        (r) => r.userId === user?.id && r.emoji === emoji
      );
      if (existingReaction) {
        socket.emit('remove_reaction', { messageId: message.id, chatId: message.chatId, emoji });
      } else {
        socket.emit('add_reaction', { messageId: message.id, chatId: message.chatId, emoji });
      }
    }
    setShowContext(false);
  };

  // Аудио плеер
  const toggleAudio = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audioManager.isPlaying(audio)) {
      audioManager.pause(audio);
      setIsPlaying(false);
    } else {
      audio.playbackRate = playbackSpeed;
      audioManager.play(audio).then(() => {
        setIsPlaying(true);
      }).catch(() => {
        setIsPlaying(false);
      });
    }
  };

  const changePlaybackSpeed = () => {
    const speeds = [1, 1.5, 2, 2.5, 3];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
    
    const audio = audioRef.current;
    if (audio) {
      audio.playbackRate = nextSpeed;
    }
    setShowSpeedMenu(false);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      if (audio.duration) {
        setAudioProgress((audio.currentTime / audio.duration) * 100);
      }
    };

    const onLoadedMetadata = () => {
      setAudioDuration(audio.duration);
    };

    const onEnded = () => {
      setIsPlaying(false);
      setAudioProgress(0);
      
      // Пометить как прослушанное
      if (message.id && user?.id) {
        const listenedKey = `voice_listened_${message.id}_${user.id}`;
        localStorage.setItem(listenedKey, 'true');
      }
      
      // Авто-переход к следующему голосовому
      const chatMessages = useChatStore.getState().messages[message.chatId] || [];
      const currentIndex = chatMessages.findIndex(m => m.id === message.id);
      if (currentIndex !== -1) {
        // Ищем следующее голосовое сообщение
        for (let i = currentIndex + 1; i < chatMessages.length; i++) {
          const nextMsg = chatMessages[i];
          const nextMedia = nextMsg.media || [];
          const hasNextVoice = nextMsg.type === 'voice' || nextMedia.some(m => m.type === 'voice');
          if (hasNextVoice) {
            // Находим аудио элемент следующего голосового
            setTimeout(() => {
              const nextAudioEl = document.querySelector(`#voice-${nextMsg.id}`) as HTMLAudioElement;
              if (nextAudioEl) {
                nextAudioEl.playbackRate = playbackSpeed;
                audioManager.play(nextAudioEl).catch(() => {});
              }
            }, 500);
            break;
          }
        }
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Extract real waveform from voice audio  
  useEffect(() => {
    const voiceUrl = normalizeMediaUrl(message.media?.find((m) => m.type === 'voice')?.url);
    if (!voiceUrl) return;
    extractWaveform(voiceUrl, 28).then(setWaveformBars);
  }, [message.media]);

  const formatDuration = (sec: number) => {
    if (!sec || isNaN(sec) || !isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Close context menu logic
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showContext) return;
    const hideMenu = (e: MouseEvent) => {
      // Don't close if clicking inside the context menu
      if (contextMenuRef.current?.contains(e.target as Node)) {
        return;
      }
      setShowContext(false);
      setDeleteMenuMode(false);
    };
    window.addEventListener('click', hideMenu, true);
    window.addEventListener('contextmenu', hideMenu, true);
    return () => {
      window.removeEventListener('click', hideMenu, true);
      window.removeEventListener('contextmenu', hideMenu, true);
    };
  }, [showContext]);

  // Close speed menu on outside click
  useEffect(() => {
    if (!showSpeedMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSpeedMenu]);

  // Deleted message — auto-hide after 5 seconds
  const [deletedVisible, setDeletedVisible] = useState(true);
  useEffect(() => {
    if (message.isDeleted) {
      const timer = setTimeout(() => setDeletedVisible(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [message.isDeleted]);

  if (message.isDeleted) {
    if (!deletedVisible) return null;
    return (
      <motion.div
        initial={{ opacity: 1, height: 'auto' }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, height: 0 }}
        className={`flex ${isMine ? 'justify-end' : 'justify-start'} mb-1`}
      >
        <div className="px-4 py-2 rounded-2xl text-sm italic text-zinc-600 bg-surface-tertiary/50">
          {t('messageDeleted')}
        </div>
      </motion.div>
    );
  }

  const media = message.media || [];
  const hasImage = media.some((m) => m.type === 'image');
  const hasVoice = message.type === 'voice' || media.some((m) => m.type === 'voice');
  const hasAudio = !hasVoice && (message.type === 'audio' || media.some((m) => m.type === 'audio'));
  const hasFile = media.some((m) => m.type !== 'image' && m.type !== 'voice' && m.type !== 'video' && m.type !== 'audio');
  const hasVideo = media.some((m) => m.type === 'video');

  // Группировка реакций (исключаем option_X для опросов)
  const reactionGroups: Record<string, { count: number; users: string[]; isMine: boolean }> = {};
  (message.reactions || []).filter(r => !r.emoji.startsWith('option_')).forEach((r) => {
    if (!reactionGroups[r.emoji]) {
      reactionGroups[r.emoji] = { count: 0, users: [], isMine: false };
    }
    reactionGroups[r.emoji].count++;
    reactionGroups[r.emoji].users.push(r.user?.displayName || r.user?.username || '');
    if (r.userId === user?.id) reactionGroups[r.emoji].isMine = true;
  });

  // Simple Markdown formatter — поддерживает ```code blocks```
  const renderFormattedText = (text: string): React.ReactNode => {
    if (!text) return text;

    // Проверяем есть ли ```code blocks```
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let cbMatch;
    let hasCodeBlocks = false;

    const tempText = text;
    while ((cbMatch = codeBlockRegex.exec(tempText)) !== null) {
      hasCodeBlocks = true;
      // Текст до блока кода
      if (cbMatch.index > lastIdx) {
        const before = tempText.slice(lastIdx, cbMatch.index);
        segments.push(renderInlineMarkdown(before));
      }
      // Блок кода
      const lang = cbMatch[1] || '';
      const code = cbMatch[2].trimEnd();
      segments.push(<CodeBlock key={`cb-${cbMatch.index}`} language={lang} code={code} />);
      lastIdx = cbMatch.index + cbMatch[0].length;
    }

    if (hasCodeBlocks) {
      if (lastIdx < text.length) {
        segments.push(renderInlineMarkdown(text.slice(lastIdx)));
      }
      return segments;
    }

    // Нет блоков кода — обычный inline markdown
    return renderInlineMarkdown(text);
  };

  // Inline markdown (ссылки, bold, italic, mentions, inline code)
  const renderInlineMarkdown = (text: string): React.ReactNode => {
    // URLs
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      parts.push(
        <a key={`url-${match.index}`} href={match[0]} target="_blank" rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 hover:underline cursor-pointer break-all" onClick={(e) => e.stopPropagation()}>
          {match[0]}
        </a>
      );
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));

    if (parts.length === 0) return text;

    return parts.map((part, i) => {
      if (typeof part === 'string') {
        const tokens = part.split(/(\*\*[\s\S]*?\*\*|\*[\s\S]*?\*|_[\s\S]*?_|~[\s\S]*?~|`[\s\S]*?`|@\w+)/g);
        return tokens.map((t, j) => {
          const key = `${i}-${j}`;
          if (t.startsWith('**') && t.endsWith('**')) return <strong key={key}>{t.slice(2, -2)}</strong>;
          if ((t.startsWith('_') && t.endsWith('_')) || (t.startsWith('*') && t.endsWith('*'))) return <em key={key}>{t.slice(1, -1)}</em>;
          if (t.startsWith('~') && t.endsWith('~')) return <del key={key}>{t.slice(1, -1)}</del>;
          if (t.startsWith('`') && t.endsWith('`')) return <code key={key} className="font-mono text-[13px] bg-black/20 px-1 py-0.5 rounded">{t.slice(1, -1)}</code>;
          if (t.startsWith('@') && t.length > 1) {
            const mentionUsername = t.slice(1);
            return (
              <span key={key} className="font-semibold text-sky-300 cursor-pointer hover:underline"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const channels = await api.searchChannels(mentionUsername);
                    const channel = channels.find(c => c.username === mentionUsername);
                    if (channel) { window.dispatchEvent(new CustomEvent('open-channel-by-username', { detail: { channel } })); return; }
                    const users = await api.searchUsers(mentionUsername);
                    const user = users.find(u => u.username === mentionUsername);
                    if (user) window.dispatchEvent(new CustomEvent('open-chat-by-username', { detail: { user } }));
                  } catch (err) { console.error('Failed to open mention:', err); }
                }}>{t}</span>
            );
          }
          return <span key={key}>{t}</span>;
        });
      }
      return part;
    });
  };

  return (
    <>
      <div
        ref={bubbleRef}
        className={`flex ${isMine ? 'justify-end' : 'justify-start'} group mb-0.5 relative transition-colors duration-200 ${selectionMode ? 'px-4 -mx-4 cursor-pointer hover:bg-white/5 rounded-xl' : ''
          } ${isSelected ? 'bg-nexo-500/10 hover:bg-nexo-500/20' : ''}`}
        onClick={() => {
          if (selectionMode) onToggleSelect?.(message.id);
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Selection Checkbox */}
        {selectionMode && (
          <div className="absolute left-1 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full border border-white/30 flex items-center justify-center transition-colors">
            {isSelected && <div className="w-5 h-5 rounded-full bg-nexo-500 flex items-center justify-center">
              <Check size={12} className="text-white" />
            </div>}
          </div>
        )}

        {/* Avatar spacing for others - only show on first message */}
        {!isMine && (
          <div className={`${showAvatar ? 'w-8 mr-2' : 'w-0 mr-0'} flex-shrink-0 self-end transition-all`}>
            {showAvatar ? (
              <button onClick={() => {
                // In channels, open channel profile instead of sender profile
                if (isChannel) {
                  const event = new CustomEvent('open-channel-profile', { detail: { channelId: message.chatId } });
                  window.dispatchEvent(event);
                } else {
                  onViewProfile?.(message.senderId);
                }
              }} className="relative inline-block">
                <Avatar 
                  src={senderAvatar} 
                  name={senderName} 
                  size="sm"
                  isVerified={message.sender?.isVerified}
                  verifiedBadgeUrl={message.sender?.verifiedBadgeUrl}
                  verifiedBadgeType={message.sender?.verifiedBadgeType}
                />
              </button>
            ) : null}
          </div>
        )}

        {/* Avatar spacing for own messages - hidden */}
        {isMine && (
          <div className="w-0 flex-shrink-0 ml-0 self-end" />
        )}

        <div className={`max-w-[65%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
          {/* Name (only for others, only on first message with avatar) */}
          {!isMine && showAvatar && (
            <button
              className="text-xs font-medium text-nexo-400 ml-3 mb-0.5 hover:underline"
              onClick={() => onViewProfile?.(message.senderId)}
            >
              {senderName}
            </button>
          )}

          {/* Reply */}
          {message.replyTo && (
            <button
              className={`w-full mx-3 mb-1 px-3 py-1.5 rounded-lg border-l-2 border-nexo-500 bg-nexo-500/10 max-w-full text-left hover:bg-nexo-500/20 transition-colors group`}
              onClick={(e) => {
                e.stopPropagation();
                // Scroll to the replied message
                const repliedMsg = chatMessages.find(m => m.id === message.replyToId);
                if (repliedMsg) {
                  const el = document.getElementById(`msg-${repliedMsg.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('bg-nexo-500/30', 'ring-2', 'ring-nexo-500');
                    setTimeout(() => {
                      el.classList.remove('bg-nexo-500/30', 'ring-2', 'ring-nexo-500');
                    }, 2000);
                  }
                }
              }}
            >
              <p className="text-xs font-medium text-nexo-400 truncate">
                {message.replyTo.sender?.displayName || message.replyTo.sender?.username}
              </p>
              <p className="text-xs text-zinc-400 truncate">{message.quote || message.replyTo.content || t('media')}</p>
            </button>
          )}

          {/* Пузырь */}
          <div
            onContextMenu={handleContextMenu}
            onDoubleClick={handleReply}
            title={t('reply') ? `${t('reply')} (Double Click)` : 'Double click to reply'}
            className={`cursor-pointer rounded-[1.25rem] overflow-hidden transition-all duration-300 ${
              hasImage && !message.content
                ? 'p-0 shadow-none border-none'
                : isMine
                  ? 'bubble-sent text-white shadow-sm px-4 py-2.5 hover:shadow-md hover:brightness-105'
                  : 'bubble-received text-zinc-100 shadow-sm px-4 py-2.5 hover:shadow-md hover:brightness-105'
            }`}
          >
            {/* Рендер пересланного сообщения */}
            {message.forwardedFrom && (
              <div className="mb-2 text-xs opacity-90 border-l-[3px] border-white/30 pl-2">
                <span className="font-medium">{t('forwardedFrom')}: </span>
                {message.forwardedFrom.displayName || message.forwardedFrom.username}
              </div>
            )}

            {/* Call Message */}
            {message.type === 'call' && (
              <div className="flex items-center gap-3 py-2">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  message.callStatus === 'missed' || message.callStatus === 'declined' 
                    ? 'bg-red-500/20' 
                    : 'bg-emerald-500/20'
                }`}>
                  {message.callStatus === 'missed' ? (
                    <PhoneMissed size={18} className="text-red-400" />
                  ) : message.callStatus === 'declined' ? (
                    <PhoneMissed size={18} className="text-red-400" />
                  ) : message.callType === 'video' ? (
                    <Video size={18} className="text-emerald-400" />
                  ) : (
                    <Phone size={18} className="text-emerald-400" />
                  )}
                </div>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${
                    message.callStatus === 'missed' || message.callStatus === 'declined'
                      ? 'text-red-400'
                      : 'text-zinc-200'
                  }`}>
                    {message.callStatus === 'missed' 
                      ? 'Пропущенный вызов'
                      : message.callStatus === 'declined'
                      ? 'Отменённый вызов'
                      : message.callStatus === 'completed'
                      ? `${message.callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок'} (${formatCallDuration(message.callDuration || 0)})`
                      : message.callType === 'video' ? 'Видеозвонок' : 'Аудиозвонок'
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Изображения */}
            {hasImage && (
              <div className={`${message.content ? 'mb-2' : ''}`}>
                <div className="grid grid-cols-2 gap-1">
                  {media
                    .filter((m) => m.type === 'image')
                    .map((m) => {
                      const imageUrl = normalizeMediaUrl(m.url);
                      return (
                        <div key={m.id} className="relative aspect-square overflow-hidden rounded-lg bg-black">
                          <img
                            src={imageUrl}
                            alt=""
                            className="w-full h-full object-cover cursor-pointer hover:brightness-90 transition-all select-none"
                            onClick={() => setLightboxUrl(imageUrl)}
                            draggable={false}
                            loading="lazy"
                            onLoad={(e) => {
                              // Image loaded successfully
                              (e.target as HTMLImageElement).style.opacity = '1';
                            }}
                            onError={(e) => {
                              console.error('[Image] Ошибка загрузки:', imageUrl);
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const parent = img.parentElement;
                              if (parent && !parent.querySelector('.broken-img')) {
                                const div = document.createElement('div');
                                div.className = 'broken-img absolute inset-0 flex flex-col items-center justify-center bg-zinc-800/90 text-zinc-500 gap-2';
                                div.innerHTML = `
                                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <circle cx="8.5" cy="8.5" r="1.5"/>
                                    <path d="m21 15-5-5L5 21"/>
                                  </svg>
                                  <span class="text-xs">Ошибка загрузки</span>
                                `;
                                parent.appendChild(div);
                              }
                            }}
                            style={{ opacity: 0, transition: 'opacity 0.3s ease' }}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Видео */}
            {hasVideo &&
              media
                .filter((m) => m.type === 'video')
                .map((m, idx) => {
                  const videoUrl = normalizeMediaUrl(m.url);
                  const size = m.size || 0;
                  const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(0)} KB`;
                  const dur = m.duration || 0;
                  const durStr = dur ? `${Math.floor(dur / 60)}:${Math.floor(dur % 60).toString().padStart(2, '0')}` : '';
                  return (
                    <VideoMessage
                      key={m.id}
                      media={m}
                      content={message.content}
                      isMine={isMine}
                      sizeStr={sizeStr}
                      durStr={durStr}
                      videoUrl={videoUrl}
                      onOpenPlayer={(url) => setShowVideoPlayer(url)}
                    />
                  );
                })}

            {/* Video Player Modal */}
            {showVideoPlayer && (
              <VideoPlayer
                src={showVideoPlayer}
                onClose={() => setShowVideoPlayer(null)}
              />
            )}

            {/* Опрос — рендерим если type === 'poll' ИЛИ если content содержит JSON опроса */}
            <PollRenderer message={message} isMine={isMine} />

            {/* Геолокация */}
            {message.type === 'location' && message.content && (() => {
              try {
                const loc = JSON.parse(message.content);
                if (loc.lat && loc.lng) {
                  return (
                    <div className="min-w-[260px]">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin size={16} className={isMine ? 'text-white/60' : 'text-nexo-400'} />
                        <span className="text-xs font-medium opacity-60">Геолокация</span>
                      </div>
                      {loc.name && (
                        <p className="text-xs mb-2 opacity-80">{loc.name}</p>
                      )}
                      <a
                        href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=16/${loc.lat}/${loc.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`block p-3 rounded-lg ${
                          isMine ? 'bg-white/10 hover:bg-white/15' : 'bg-nexo-500/10 hover:bg-nexo-500/20'
                        } transition-colors`}
                      >
                        <p className="text-xs font-mono">
                          {loc.lat.toFixed(6)}, {loc.lng.toFixed(6)}
                        </p>
                        {loc.accuracy && (
                          <p className="text-xs opacity-60 mt-1">
                            Точность: ±{loc.accuracy < 1000 ? `${Math.round(loc.accuracy)} м` : `${(loc.accuracy / 1000).toFixed(1)} км`}
                          </p>
                        )}
                      </a>
                    </div>
                  );
                }
              } catch (e) {
                // ignore
              }
              return null;
            })()}

            {/* Голосовое - Telegram style */}
            {hasVoice && (() => {
              const voiceMedia = media.find((m) => m.type === 'voice');
              if (!voiceMedia?.url) return null;
              const voiceUrl = normalizeMediaUrl(voiceMedia.url);
              if (!voiceUrl) return null;

              const duration = voiceMedia.duration || 0;
              const size = voiceMedia.size || 0;
              const sizeStr = size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${(size / 1024).toFixed(0)} KB`;
              const voiceId = `voice-${message.id}`;
              
              // Проверка, прослушано ли сообщение
              const listenedKey = `voice_listened_${message.id}_${user?.id}`;
              const isListened = localStorage.getItem(listenedKey) === 'true';

              if (loadError) {
                return (
                  <div className="flex items-center gap-3 min-w-[220px] max-w-[300px]">
                    <div className="flex-1 text-center py-3">
                      <p className="text-xs opacity-60 mb-2">Не удалось загрузить</p>
                      <button
                        onClick={() => { setLoadError(false); setIsPlaying(false); }}
                        className={`text-xs px-3 py-1.5 rounded-lg ${
                          isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-blue-500/20 hover:bg-blue-500/30'
                        } transition-colors`}
                      >
                        🔄 Повторить
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div className="flex items-center gap-3 min-w-[220px] max-w-[300px]">
                  <audio
                    ref={(el) => {
                      if (el) {
                        el.playbackRate = playbackSpeed;
                      }
                      // @ts-ignore - assigning ref correctly
                      audioRef.current = el;
                    }}
                    id={voiceId}
                    src={voiceUrl}
                    preload="auto"
                    onError={() => {
                      // Файл недоступен — показываем fallback UI
                      setLoadError(true);
                      setIsPlaying(false);
                    }}
                  />
                  {/* Play button */}
                  <button
                    onClick={toggleAudio}
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all relative ${
                      isMine
                        ? 'bg-white/25 hover:bg-white/35'
                        : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/20'
                    }`}
                  >
                    {isPlaying ? (
                      <Pause size={18} className="text-white" />
                    ) : (
                      <Play size={18} className="text-white ml-0.5" />
                    )}
                    {/* Индикатор прослушанного */}
                    {isListened && !isPlaying && (
                      <div className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white">
                        <Check size={8} className="text-white" strokeWidth={3} />
                      </div>
                    )}
                  </button>

                  {/* Waveform + info + speed button */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {/* Waveform */}
                      <div
                        className="flex-1 flex items-end gap-[2px] h-7 cursor-pointer"
                        onClick={(e) => {
                          const audio = audioRef.current;
                          if (!audio) return;
                          if (!audioManager.isPlaying(audio)) {
                            toggleAudio();
                            return;
                          }
                          if (!audio.duration) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                          audio.currentTime = pct * audio.duration;
                          setAudioProgress(pct * 100);
                        }}
                      >
                        {(waveformBars || Array(28).fill(0.5)).map((val, i) => {
                          const barHeight = Math.max(8, val * 100);
                          const progress = audioProgress / 100;
                          const barProgress = i / 28;
                          const isActive = barProgress < progress;
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-full transition-colors duration-100 ${
                                isActive
                                  ? isMine ? 'bg-white' : 'bg-blue-300'
                                  : isMine ? 'bg-white/30' : 'bg-white/20'
                              }`}
                              style={{ height: `${barHeight}%` }}
                            />
                          );
                        })}
                      </div>
                      
                      {/* Кнопка скорости воспроизведения */}
                      <div className="relative" ref={speedMenuRef}>
                        <button
                          onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors flex-shrink-0 ${
                            isMine
                              ? 'bg-white/20 hover:bg-white/30 text-white/80'
                              : 'bg-blue-500/30 hover:bg-blue-500/40 text-blue-200'
                          }`}
                        >
                          {playbackSpeed}x
                        </button>

                        {/* Меню выбора скорости — через portal чтобы не обрезалось overflow-hidden */}
                        {showSpeedMenu && createPortal(
                          <div className="fixed py-1 rounded-lg bg-zinc-900/95 backdrop-blur-xl border border-white/10 shadow-xl z-[99999]"
                            style={{
                              bottom: `${window.innerHeight - (speedMenuRef.current?.getBoundingClientRect().top || 0) + 8}px`,
                              left: `${speedMenuRef.current?.getBoundingClientRect().left || 0}px`,
                              minWidth: '80px'
                            }}
                          >
                            {[1, 1.5, 2, 2.5, 3].map((speed) => (
                              <button
                                key={speed}
                                onClick={() => {
                                  setPlaybackSpeed(speed);
                                  const audio = audioRef.current;
                                  if (audio) {
                                    audio.playbackRate = speed;
                                  }
                                  setShowSpeedMenu(false);
                                }}
                                className={`w-full px-3 py-1.5 text-xs text-left transition-colors ${
                                  playbackSpeed === speed
                                    ? 'bg-nexo-500/30 text-nexo-300'
                                    : 'text-zinc-300 hover:bg-white/10'
                                }`}
                              >
                                {speed}x
                              </button>
                            ))}
                          </div>,
                          document.body
                        )}
                      </div>
                    </div>
                    
                    {/* Duration + size */}
                    <div className="flex items-center justify-between">
                      <span className={`text-xs ${isMine ? 'text-white/70' : 'text-blue-200'}`}>
                        {isPlaying
                          ? formatDuration(audioRef.current?.currentTime || 0)
                          : formatDuration(duration || audioDuration || 0)}
                      </span>
                      <span className={`text-[10px] ${isMine ? 'text-white/40' : 'text-blue-300/60'}`}>
                        {sizeStr}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Аудио (mp3 файлы) */}
            {hasAudio && (() => {
              const audioMedia = media.find((m) => m.type === 'audio');
              if (!audioMedia?.url) return null;
              const audioUrl = normalizeMediaUrl(audioMedia.url);
              if (!audioUrl) return null;

              return (
                <div className="min-w-[220px]">
                  {audioMedia?.filename && (
                    <div className="flex items-center gap-2 mb-2">
                      <Volume2 size={14} className={isMine ? 'text-white/60' : 'text-nexo-400'} />
                      <span className={`text-xs truncate ${isMine ? 'text-white/70' : 'text-zinc-400'}`}>{audioMedia.filename}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <audio
                      ref={audioRef}
                      src={audioUrl}
                      preload="auto"
                      onError={() => {
                        console.error('[Audio] Ошибка загрузки:', audioUrl);
                        setIsPlaying(false);
                        setAudioProgress(0);
                      }}
                    />
                    <button
                      onClick={toggleAudio}
                      className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isMine ? 'bg-white/20 hover:bg-white/30' : 'bg-nexo-500/20 hover:bg-nexo-500/30'
                      } transition-colors`}
                    >
                      {isPlaying ? (
                        <Pause size={16} className={isMine ? 'text-white' : 'text-nexo-400'} />
                      ) : (
                        <Play size={16} className={`${isMine ? 'text-white' : 'text-nexo-400'} ml-0.5`} />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-[2px] h-6">
                        {Array.from({ length: 28 }).map((_, i) => {
                          const barHeight = [40, 65, 35, 80, 50, 90, 45, 70, 55, 85, 30, 75, 60, 95, 40, 80, 50, 70, 35, 90, 55, 65, 45, 85, 60, 75, 50, 40][i] || 50;
                          const progress = audioProgress / 100;
                          const barProgress = i / 28;
                          const isActive = barProgress < progress;
                          return (
                            <div
                              key={i}
                              className={`flex-1 rounded-full transition-colors duration-150 ${isActive
                                ? isMine ? 'bg-white/80' : 'bg-nexo-400'
                                : isMine ? 'bg-white/20' : 'bg-white/10'
                                }`}
                              style={{ height: `${barHeight}%` }}
                            />
                          );
                        })}
                      </div>
                      <span className={`text-xs mt-0.5 block ${isMine ? 'text-white/60' : 'text-zinc-500'}`}>
                        {isPlaying
                          ? formatDuration(audioRef.current?.currentTime || 0)
                          : formatDuration(audioDuration || 0)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Файлы (Album support) */}
            {hasFile && (
              <div className={`${message.content ? 'mb-2' : ''}`}>
                {/* Grid: 1 column on mobile, 3 columns on desktop */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1">
                  {media
                    .filter((m) => m.type !== 'image' && m.type !== 'voice' && m.type !== 'video')
                    .map((m) => {
                      // Shorten long filenames (>11 chars → 5 + ... + extension)
                      let displayName = m.filename || t('fileLabel');
                      if (displayName.length > 11) {
                        const lastDot = displayName.lastIndexOf('.');
                        if (lastDot > 0) {
                          const ext = displayName.slice(lastDot);
                          const name = displayName.slice(0, 5);
                          displayName = `${name}...${ext}`;
                        } else {
                          displayName = `${displayName.slice(0, 5)}...`;
                        }
                      }
                      
                      return (
                        <a
                          key={m.id}
                          href={normalizeMediaUrl(m.url)}
                          download={m.filename || 'file'}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={m.filename || undefined} // Show full name on hover
                          className={`flex flex-col items-center justify-center gap-1 p-2 rounded-xl min-h-[80px] ${
                            isMine ? 'bg-white/10 hover:bg-white/15' : 'bg-surface-tertiary hover:bg-surface-hover'
                          } transition-colors`}
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            isMine ? 'bg-white/20' : 'bg-nexo-500/20'
                          }`}>
                            <FileText size={20} className={isMine ? 'text-white' : 'text-nexo-400'} />
                          </div>
                          <p className="text-xs text-center truncate w-full" title={m.filename || undefined}>
                            {displayName}
                          </p>
                          <p className={`text-[10px] ${isMine ? 'text-white/50' : 'text-zinc-500'}`}>
                            {m.size ? `${(m.size / 1024).toFixed(1)} KB` : ''}
                          </p>
                        </a>
                      );
                    })}
                </div>
              </div>
            )}

            {/* Текст (исключая poll, location, voice, call) */}
            {message.content && message.type !== 'poll' && message.type !== 'location' && message.type !== 'voice' && message.type !== 'call' && (
              <div ref={contentRef} className="flex items-end gap-2">
                <div className={`text-sm flex-1 leading-relaxed overflow-hidden ${isCollapsed ? 'max-h-[300px]' : ''}`}>
                  <p className="whitespace-pre-wrap break-all word-break">
                    {renderFormattedText(message.content)}
                  </p>
                </div>
                {showCollapse && (
                  <button
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="text-[10px] text-nexo-400 hover:text-nexo-300 transition-colors flex-shrink-0 self-end"
                  >
                    {isCollapsed ? '▼' : '▲'}
                  </button>
                )}
                <span className={`text-[10px] flex-shrink-0 flex items-center gap-0.5 self-end select-none ${isMine ? 'text-white/50' : 'text-zinc-500'
                  }`}>
                  {message.isEdited && <span>{t('edited')}</span>}
                  {message.scheduledAt && <Clock size={11} className="text-amber-400 mr-0.5" />}
                  {timeStr}
                  {!message.scheduledAt && (
                    isChannel ? (
                      /* В каналах просмотры показываются для всех сообщений */
                      <span className="flex items-center gap-1 ml-0.5 text-xs">
                        <Eye size={11} className="text-zinc-400" />
                        {message.viewCount || 0}
                      </span>
                    ) : isMine && isRead ? (
                      <CheckCheck size={13} className="text-sky-300 ml-0.5" />
                    ) : isMine ? (
                      <Check size={13} className="ml-0.5" />
                    ) : null
                  )}
                </span>
              </div>
            )}

            {/* YouTube Preview - detect URLs in content */}
            {message.content && isChannel && (() => {
              const ytPattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)[a-zA-Z0-9_-]{11}/g;
              const ytUrls = message.content.match(ytPattern);
              if (ytUrls && ytUrls.length > 0) {
                return (
                  <>
                    {Array.from(new Set(ytUrls)).map((url, i) => (
                      <YouTubePreview key={i} url={url} />
                    ))}
                  </>
                );
              }
              return null;
            })()}

            {/* Link Embed Preview для каналов */}
            {message.content && isChannel && (
              <LinkEmbedPreview content={message.content} />
            )}

            {/* Время для медиа без текста */}
            {!message.content && (hasImage || hasVideo) && (
              <div className={`flex justify-end px-3 py-1 ${hasImage ? '-mt-8 relative z-10' : ''}`}>
                <span className="text-[10px] text-white/70 bg-black/40 px-2 py-0.5 rounded-full flex items-center gap-1 backdrop-blur-sm select-none">
                  {timeStr}
                  {isChannel ? (
                    /* В каналах просмотры для всех сообщений */
                    <span className="flex items-center gap-1">
                      <Eye size={11} className="text-zinc-400" />
                      {message.viewCount || 0}
                    </span>
                  ) : isMine ? (
                    isRead ? <CheckCheck size={13} className="text-sky-300" /> : <Check size={13} />
                  ) : null}
                </span>
              </div>
            )}
          </div>

          {/* Реакции */}
          {Object.keys(reactionGroups).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1 mx-1">
              {Object.entries(reactionGroups).map(([emoji, data]) => (
                <button
                  key={emoji}
                  onClick={() => handleReaction(emoji)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors ${data.isMine
                    ? 'bg-nexo-500/30 border border-nexo-500/50'
                    : 'bg-surface-tertiary border border-border hover:border-zinc-600'
                    }`}
                  title={data.users.join(', ')}
                >
                  <span>{emoji}</span>
                  <span className="text-zinc-400">{data.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Own avatar - hidden (user's own messages don't show avatar) */}
        {isMine && (
          <div className="w-0 flex-shrink-0 ml-0 self-end" />
        )}
      </div>

      {/* Контекстное меню */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showContext && (
            <motion.div
              ref={contextMenuRef}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="fixed z-[9999] w-[280px] max-w-[calc(100vw-16px)] rounded-[1.25rem] glass-strong shadow-2xl py-1.5 overflow-hidden border border-white/10"
              style={{ 
                left: Math.min(contextPos.x, window.innerWidth - 296), 
                top: Math.min(contextPos.y, window.innerHeight - 400) 
              }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              {deleteMenuMode ? (
                <>
                  {/* Delete submenu */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
                    <button
                      onClick={() => setDeleteMenuMode(false)}
                      className="p-1 rounded-lg hover:bg-surface-hover transition-colors text-zinc-400 hover:text-white"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <span className="text-sm font-medium text-zinc-300">{t('delete')}</span>
                  </div>
                  <button
                    onClick={handleDeleteForMe}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                  >
                    <Trash2 size={16} className="text-zinc-400" />
                    {t('deleteForMe')}
                  </button>
                  {(isMine || canManageMessages) && (
                  <button
                    onClick={handleDeleteForAll}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                  >
                    <Trash2 size={16} />
                    {chatForDelete?.type === 'personal' && otherMemberName
                      ? `${t('deleteAlsoFor')} ${otherMemberName}`
                      : t('deleteForAll')}
                  </button>
                  )}
                </>
              ) : (
                <>
              {/* Быстрые реакции */}
              <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
                {['👍', '❤️', '😂', '😮', '😢', '🔥'].map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleReaction(emoji)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-hover transition-colors text-lg"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <button
                onClick={handleReply}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <Reply size={16} />
                {quotedText ? t('replyWithQuote') : t('reply')}
              </button>

              <button
                onClick={() => {
                  setShowContext(false);
                  onStartSelectionMode?.(message.id);
                }}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <CheckCheck size={16} />
                {t('select')}
              </button>

              <button
                onClick={handlePin}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
              >
                <Pin size={16} />
                {isPinned ? t('unpinMessage') : t('pinMessage')}
              </button>

              {message.content && (
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                >
                  <Copy size={16} />
                  {t('copy')}
                </button>
              )}

              {/* Edit - owner can edit too */}
              {(isMine || (canManageMessages && message.content)) && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-zinc-300 hover:bg-surface-hover hover:text-white transition-colors"
                >
                  <Pencil size={16} />
                  {t('edit')}
                </button>
              )}

              <div className="border-t border-border my-1" />
              <button
                onClick={() => setDeleteMenuMode(true)}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={16} />
                {t('delete')}
              </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxUrl && (
          <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Отдельный компонент для видео-сообщений — изолирует state ошибки загрузки
 */
function VideoMessage({
  media,
  content,
  isMine,
  sizeStr,
  durStr,
  videoUrl: externalVideoUrl,
  onOpenPlayer,
}: {
  media: MediaItem;
  content: string | null;
  isMine: boolean;
  sizeStr: string;
  durStr: string;
  videoUrl?: string;
  onOpenPlayer: (url: string) => void;
}) {
  const [loadError, setLoadError] = useState(false);
  const videoUrl = externalVideoUrl || normalizeMediaUrl(media.url);
  const posterUrl = normalizeMediaUrl(media.thumbnail);

  return (
    <div className={`${content ? 'mb-2 -mx-3 -mt-2' : ''}`}>
      <div
        className="relative rounded-2xl overflow-hidden bg-black group cursor-pointer shadow-lg"
        onClick={() => !loadError && onOpenPlayer(videoUrl)}
      >
        {!loadError ? (
          <video
            src={videoUrl}
            poster={posterUrl || ''}
            className="w-full max-w-[320px] max-h-64 object-contain"
            preload="metadata"
            crossOrigin="anonymous"
            onError={() => {
              // Файл недоступен — показываем fallback UI
              setLoadError(true);
            }}
          />
        ) : (
          /* Фоллбэк при ошибке загрузки — пробуем открыть напрямую */
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col items-center justify-center w-full max-w-[320px] h-48 bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <Video size={32} className="mb-2 opacity-50" />
            <span className="text-xs">Не удалось загрузить видео</span>
            <span className="text-[10px] opacity-60 mt-1">Нажмите чтобы открыть в новой вкладке</span>
          </a>
        )}
        {/* Play overlay — только если нет ошибки */}
        {!loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-all">
            <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:scale-110 transition-transform border border-white/30">
              <Play size={24} className="text-white ml-1" />
            </div>
          </div>
        )}
        {/* Duration/size badge */}
        {!loadError && (durStr || sizeStr) && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
            {durStr && (
              <span className="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-xs text-white font-mono">
                {durStr}
              </span>
            )}
            {sizeStr && (
              <span className="px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-white/70">
                {sizeStr}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Отдельный компонент для рендеринга опросов (Telegram-style).
 * Голосование через vote_poll socket событие, не через реакции.
 */
function PollRenderer({ message, isMine }: { message: Message; isMine: boolean }) {
  const { user } = useAuthStore();
  const { messages } = useChatStore();
  const [userVote, setUserVote] = useState<number | null>(null);
  const [voteCounts, setVoteCounts] = useState<Record<number, number>>({});

  // Инициализация голосов из pollVotes
  useEffect(() => {
    const chatMessages = messages[message.chatId] || [];
    const currentMsg = chatMessages.find(m => m.id === message.id);
    const pollVotes = (currentMsg as any)?.pollVotes || [];

    const counts: Record<number, number> = {};
    let myVote: number | null = null;

    pollVotes.forEach((v: any) => {
      counts[v.optionIndex] = (counts[v.optionIndex] || 0) + 1;
      if (v.userId === user?.id) {
        myVote = v.optionIndex;
      }
    });

    setVoteCounts(counts);
    setUserVote(myVote);
  }, [message.id, message.chatId, messages, user?.id]);

  // Слушаем обновления голосования в реальном времени
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handlePollUpdate = (data: {
      messageId: string;
      voteCounts: Record<number, number>;
      hasVoted: boolean;
      userId: string;
      optionIndex: number;
      removed?: boolean;
    }) => {
      if (data.messageId !== message.id) return;
      setVoteCounts(data.voteCounts);
      if (data.userId === user?.id) {
        setUserVote(data.removed ? null : data.optionIndex);
      }
    };

    socket.on('poll_updated', handlePollUpdate);
    return () => { socket.off('poll_updated', handlePollUpdate); };
  }, [message.id, user?.id]);

  // Проверяем что это действительно опрос
  const isPoll = message.type === 'poll' || (message.content && message.content.startsWith('{"question"'));
  if (!isPoll || !message.content) return null;

  let poll: { question: string; options: string[]; multiple?: boolean; quiz?: boolean; correctAnswer?: number };
  try {
    poll = JSON.parse(message.content);
    if (!poll.question || !Array.isArray(poll.options)) return null;
  } catch {
    return null;
  }

  const totalVotes = Object.values(voteCounts).reduce((sum, c) => sum + c, 0);
  const hasVoted = userVote !== null || totalVotes > 0;

  const handleVote = (optionIndex: number) => {
    if (userVote === optionIndex && !poll.multiple) return; // Уже проголосовал за этот вариант

    const socket = getSocket();
    if (!socket) return;

    if (userVote !== null && !poll.multiple) {
      // Снимаем предыдущий голос и голосуем за новый
      socket.emit('unvote_poll', { messageId: message.id, chatId: message.chatId, optionIndex: userVote });
      setTimeout(() => {
        socket.emit('vote_poll', { messageId: message.id, chatId: message.chatId, optionIndex });
      }, 50);
    } else {
      // Голосуем
      socket.emit('vote_poll', { messageId: message.id, chatId: message.chatId, optionIndex });
    }
  };

  return (
    <div className="min-w-[280px] max-w-[340px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={16} className={isMine ? 'text-white/60' : 'text-nexo-400'} />
        <span className="text-xs font-medium opacity-60">
          {poll.quiz ? 'Викторина' : 'Опрос'}
        </span>
        {totalVotes > 0 && (
          <span className="text-xs opacity-50">
            {totalVotes} {totalVotes === 1 ? 'голос' : totalVotes < 5 ? 'голоса' : 'голосов'}
          </span>
        )}
      </div>

      {/* Question */}
      <p className="text-sm font-semibold mb-3 leading-snug">{poll.question}</p>

      {/* Options */}
      <div className="space-y-2">
        {poll.options.map((option: string, i: number) => {
          const optionVotes = voteCounts[i] || 0;
          const percentage = totalVotes > 0 ? Math.round((optionVotes / totalVotes) * 100) : 0;
          const isCorrect = poll.quiz && poll.correctAnswer === i;
          const isMyVote = userVote === i;

          return (
            <button
              key={i}
              disabled={hasVoted && !poll.multiple}
              onClick={() => handleVote(i)}
              className={`relative w-full px-3 py-2.5 rounded-xl text-sm transition-all duration-300 ${
                hasVoted && !poll.multiple
                  ? isMine ? 'bg-white/10 cursor-default' : 'bg-nexo-500/10 cursor-default'
                  : isMine
                    ? 'bg-white/15 hover:bg-white/25 active:scale-[0.98] cursor-pointer'
                    : 'bg-nexo-500/15 hover:bg-nexo-500/25 active:scale-[0.98] cursor-pointer'
              }`}
            >
              {/* Progress bar background */}
              {hasVoted && (
                <div
                  className={`absolute inset-0 rounded-xl transition-all duration-500 ease-out ${
                    isCorrect
                      ? 'bg-emerald-500/30'
                      : isMyVote
                        ? isMine ? 'bg-white/40' : 'bg-nexo-500/50'
                        : isMine ? 'bg-white/20' : 'bg-nexo-500/30'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              )}

              {/* Option content */}
              <div className="relative flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {/* Checkmark if this is my vote */}
                  {hasVoted && isMyVote && (
                    <span className="text-nexo-400 text-xs flex-shrink-0">✓</span>
                  )}
                  {isCorrect && hasVoted && (
                    <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>
                  )}
                  <span className="flex-1 truncate text-left">{option}</span>
                </div>
                {hasVoted && (
                  <span className="text-xs font-medium opacity-80 flex-shrink-0 tabular-nums">
                    {percentage}%
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      {poll.multiple && (
        <div className="mt-2 text-xs opacity-50 flex items-center gap-1">
          <span>Можно выбрать несколько</span>
        </div>
      )}
      {!hasVoted && (
        <div className="mt-2 text-xs opacity-40 text-center">
          Выберите вариант
        </div>
      )}
    </div>
  );
}

export default memo(MessageBubble);
