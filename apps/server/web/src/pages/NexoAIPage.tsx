import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, Loader2, X, ArrowLeft, Forward, Download, Edit2, Trash2, Plus, MessageSquare, Sparkles } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { api } from '../lib/api';
import CodeBlock from '../components/CodeBlock';

interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface AIChat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: AIMessage[];
}

interface ChatListItem {
  id: string;
  title: string;
  lastMessage?: string;
  updatedAt: string;
}

export default function NexoAIPage({ onClose, isFullMode }: { onClose?: () => void; isFullMode?: boolean }) {
  const { token } = useAuthStore();
  const [chatList, setChatList] = useState<ChatListItem[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false); // Всегда скрыта по умолчанию
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [messageToForward, setMessageToForward] = useState<AIMessage | null>(null);
  const [chatsForForward, setChatsForForward] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /** Определяем мобильное устройство */
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /** Загрузка списка чатов */
  const loadChatList = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const chats = await res.json();
        setChatList(chats.map((c: any) => ({
          id: c.id,
          title: c.title,
          lastMessage: c.messages[0]?.content || '',
          updatedAt: c.updatedAt
        })));
      }
    } catch (error) {
      console.error('Error loading chat list:', error);
    }
  }, [token]);

  /** Загрузка сообщений чата */
  const loadChatMessages = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${chatId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const msgs = await res.json();
        setMessages(msgs.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.createdAt).getTime()
        })));
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }, [token]);

  /** Создание нового чата */
  const createNewChat = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: 'Новый чат' })
      });
      if (res.ok) {
        const chat = await res.json();
        await loadChatList();
        setCurrentChatId(chat.id);
        setMessages([]);
        setShowSidebar(false); // Всегда скрываем при новом чате
      }
    } catch (error) {
      console.error('Error creating chat:', error);
    }
  }, [token]);

  /** Удаление чата */
  const deleteChat = useCallback(async (chatId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm('Удалить этот чат?')) return;
    
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${chatId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        if (currentChatId === chatId) {
          setCurrentChatId(null);
          setMessages([]);
        }
        await loadChatList();
      }
    } catch (error) {
      console.error('Error deleting chat:', error);
    }
  }, [token, currentChatId]);

  /** Редактирование названия чата */
  const startEditingChat = (chat: ChatListItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const saveChatTitle = async () => {
    if (!editingChatId || !editTitle.trim()) return;
    
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${editingChatId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: editTitle.trim() })
      });
      if (res.ok) {
        await loadChatList();
      }
    } catch (error) {
      console.error('Error updating chat title:', error);
    }
    setEditingChatId(null);
    setEditTitle('');
  };

  /** Экспорт чата в JSON */
  const exportChat = useCallback(async () => {
    if (!currentChatId) return;
    
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${currentChatId}/export`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexo-ai-chat-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Error exporting chat:', error);
    }
  }, [token, currentChatId]);

  /** Загрузка чатов для пересылки (только личные чаты и группы, не каналы) */
  const loadChatsForForward = useCallback(async () => {
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/chats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const chats = await res.json();
        // Фильтруем только личные чаты и группы, не каналы
        const filtered = chats.filter((c: any) => c.type !== 'channel');
        setChatsForForward(filtered);
      }
    } catch (error) {
      console.error('Error loading chats for forward:', error);
    }
  }, [token]);

  /** Пересылка сообщения из AI чата в обычный чат */
  const forwardMessage = useCallback(async (targetChatId: string) => {
    if (!messageToForward || !currentChatId) return;
    
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          chatId: targetChatId,
          content: messageToForward.content,
          type: 'text',
          forwardedFromId: 'ai-chat' // Специальный маркер
        })
      });
      
      if (res.ok) {
        setShowForwardModal(false);
        setMessageToForward(null);
      }
    } catch (error) {
      console.error('Error forwarding message:', error);
    }
  }, [token, messageToForward, currentChatId]);

  /** Выбор чата из списка */
  const selectChat = useCallback((chatId: string) => {
    setCurrentChatId(chatId);
    loadChatMessages(chatId);
    if (isMobile) setShowSidebar(false);
  }, [loadChatMessages, isMobile]);

  /** Автоскролл вниз */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Загрузка начальных данных */
  useEffect(() => {
    loadChatList();
  }, [loadChatList]);

  /** Инициализация распознавания речи */
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'ru-RU';

      recognitionRef.current.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }

        if (finalTranscript) {
          setInput(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognitionRef.current.onerror = () => {
        setIsRecording(false);
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }
  }, []);

  /** Переключение записи голоса */
  const toggleRecording = useCallback(() => {
    if (!recognitionRef.current) {
      console.warn('Speech Recognition not supported');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
      } catch {
        // Уже записывает
      }
    }
  }, [isRecording]);

  /** Отправка сообщения со стримингом */
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isSending) return;

    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    const userInput = input.trim();
    setInput('');
    setIsSending(true);

    // Создаём placeholder для ответа AI
    const assistantId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }]);

    // Отменяем предыдущий запрос если есть
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      // Формируем историю сообщений
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      history.push({ role: 'user', content: userInput });

      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: history }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error('Network error');
      }

      // Читаем SSE стрим
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              if (json.token) {
                fullText += json.token;
                // Обновляем сообщение AI в реальном времени
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: fullText } : m
                ));
              }
              if (json.done) {
                fullText = json.text || fullText;
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: fullText, isStreaming: false } : m
                ));
                // Сохраняем сообщения в базу после получения ответа
                if (currentChatId) {
                  // Сохраняем пользовательское сообщение
                  await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${currentChatId}/messages`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ role: 'user', content: userInput })
                  });
                  // Сохраняем ответ AI
                  await fetch(`${import.meta.env.VITE_API_URL || ''}/api/ai/chats/${currentChatId}/messages`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${token}`,
                    },
                    body: JSON.stringify({ role: 'assistant', content: fullText })
                  });
                }
              }
              if (json.error) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: '⚠️ ' + json.error, isStreaming: false } : m
                ));
              }
            } catch {
              // Игнорируем ошибки парсинга
            }
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setMessages(prev => prev.map(m =>
          m.id === assistantId
            ? { ...m, content: '❌ Не удалось получить ответ. Попробуй позже.', isStreaming: false }
            : m
        ));
      }
    } finally {
      setIsSending(false);
      abortControllerRef.current = null;
    }
  }, [input, isSending, messages, token, currentChatId]);

  /** Отправка по Enter */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /** Приветственное сообщение */
  const welcomeMessage = "Привет! Я Nexo AI 🤖\n\nМогу помочь с ответами на вопросы, переводами, кодом или просто поболтать. Спрашивай что угодно!";

  /** Рендер сообщения ИИ с code blocks + inline markdown */
  const renderAIMessage = (content: string): React.ReactNode => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let match;
    let hasCode = false;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      hasCode = true;
      if (match.index > lastIdx) {
        segments.push(renderInlineAI(content.slice(lastIdx, match.index)));
      }
      segments.push(<CodeBlock key={`cb-${match.index}`} language={match[1] || ''} code={match[2].trimEnd()} />);
      lastIdx = match.index + match[0].length;
    }

    if (hasCode) {
      if (lastIdx < content.length) {
        segments.push(renderInlineAI(content.slice(lastIdx)));
      }
      return segments;
    }

    return renderInlineAI(content);
  };

  /** Inline markdown для ИИ (bold, italic, code, strike) */
  const renderInlineAI = (text: string): React.ReactNode => {
    const tokens = text.split(/(\*\*[\s\S]*?\*\*|~~[\s\S]*?~~|\*[\s\S]*?\*|`[\s\S]*?`)/g);
    return tokens.map((t, i) => {
      if (t.startsWith('**') && t.endsWith('**')) return <strong key={i}>{t.slice(2, -2)}</strong>;
      if (t.startsWith('~~') && t.endsWith('~~')) return <del key={i}>{t.slice(2, -2)}</del>;
      if ((t.startsWith('*') && t.endsWith('*'))) return <em key={i}>{t.slice(1, -1)}</em>;
      if (t.startsWith('`') && t.endsWith('`')) return <code key={i} className="font-mono text-[13px] bg-black/30 px-1.5 py-0.5 rounded">{t.slice(1, -1)}</code>;
      return <span key={i} className="whitespace-pre-wrap">{t}</span>;
    });
  };

  return (
    <div className="h-full flex flex-col relative bg-[#0a0a0f]">
      {/* ====== HEADER ====== */}
      <div className="h-[60px] sm:h-[64px] px-4 flex items-center gap-3 flex-shrink-0 border-b border-white/5 bg-[#09090b]/80 backdrop-blur-xl">
        {/* Меню (открыть список чатов) */}
        <button
          onClick={() => setShowSidebar(true)}
          className="glass-btn w-10 h-10 rounded-xl text-zinc-300 hover:text-white flex-shrink-0"
          title="Чаты AI"
        >
          <MessageSquare size={18} />
        </button>

        {/* Логотип и название */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="relative">
            <div className="absolute inset-0 bg-purple-500/30 blur-xl rounded-xl" />
            <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-lg">
              <Sparkles size={16} className="text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-base font-semibold text-white truncate">Nexo AI</h1>
            <p className="text-[10px] text-zinc-500">Умный ассистент</p>
          </div>
        </div>

        {/* Кнопки управления */}
        <div className="flex items-center gap-1.5">
          {/* Экспорт чата */}
          {currentChatId && (
            <button
              onClick={exportChat}
              className="glass-btn w-9 h-9 rounded-xl text-zinc-400 hover:text-white"
              title="Экспортировать"
            >
              <Download size={16} />
            </button>
          )}
          
          {/* Новый чат */}
          <button
            onClick={createNewChat}
            className="glass-btn w-9 h-9 rounded-xl text-nexo-400 hover:text-white"
            title="Новый чат"
          >
            <Plus size={16} />
          </button>

          {/* Закрыть */}
          {onClose && (
            <button
              onClick={onClose}
              className="glass-btn w-9 h-9 rounded-xl text-zinc-400 hover:text-white"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ====== SIDEBAR СО СПИСКОМ ЧАТОВ ====== */}
        <AnimatePresence>
          {showSidebar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: isMobile ? '100%' : 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="border-r border-white/10 bg-white/5 backdrop-blur-xl overflow-hidden flex-shrink-0"
            >
              <div className={`h-full flex flex-col ${isMobile ? 'w-full' : 'w-[320px]'}`}>
                {/* Заголовок */}
                <div className="px-4 py-4 border-b border-white/10 flex items-center justify-between bg-white/5">
                  <h2 className="text-base font-semibold text-white">История чатов</h2>
                  {isMobile && (
                    <button onClick={() => setShowSidebar(false)} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 hover:text-white transition-all">
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* Список чатов */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {chatList.map((chat) => (
                    <div
                      key={chat.id}
                      onClick={() => selectChat(chat.id)}
                      className={`group p-4 rounded-2xl cursor-pointer transition-all duration-200 ${
                        currentChatId === chat.id
                          ? 'bg-gradient-to-r from-purple-500/20 to-blue-500/20 border border-purple-500/30 shadow-lg'
                          : 'hover:bg-white/10 border border-white/10/50 hover:border-white/20 hover:shadow-md'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center flex-shrink-0 shadow-sm">
                          <MessageSquare size={20} className="text-purple-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingChatId === chat.id ? (
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              onBlur={saveChatTitle}
                              onKeyDown={(e) => e.key === 'Enter' && saveChatTitle()}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full bg-white/10 text-white text-sm px-3 py-2 rounded-xl outline-none border border-white/20 focus:border-purple-400 transition-colors"
                              autoFocus
                            />
                          ) : (
                            <>
                              <h3 className="text-sm font-semibold text-white truncate">{chat.title}</h3>
                              <p className="text-xs text-white/60 mt-1 truncate">
                                {chat.lastMessage || 'Нет сообщений'}
                              </p>
                            </>
                          )}
                        </div>
                        {/* Действия с чатом */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                          <button
                            onClick={(e) => startEditingChat(chat, e)}
                            className="w-8 h-8 rounded-xl hover:bg-white/10 text-white/60 hover:text-white transition-all"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => deleteChat(chat.id, e)}
                            className="w-8 h-8 rounded-xl hover:bg-red-500/20 text-white/60 hover:text-red-400 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {chatList.length === 0 && (
                    <div className="text-center py-12 text-white/40 text-sm">
                      <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                        <MessageSquare size={24} className="text-white/30" />
                      </div>
                      Нет чатов. Создайте первый!
                    </div>
                  )}
                </div>

                {/* Кнопка создания */}
                {!isMobile && (
                  <div className="p-4 border-t border-white/10">
                    <button
                      onClick={createNewChat}
                      className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white rounded-xl text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl"
                    >
                      <Plus size={16} />
                      Новый чат
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ====== ОСНОВНАЯ ОБЛАСТЬ С СООБЩЕНИЯМИ ====== */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Кнопка открытия сайдбара на мобильных */}
          {isMobile && !showSidebar && (
            <button
              onClick={() => setShowSidebar(true)}
              className="absolute top-3 left-3 z-20 glass-btn w-9 h-9 rounded-xl text-zinc-400"
            >
              <MessageSquare size={18} />
            </button>
          )}

           {/* СООБЩЕНИЯ */}
          <div className="flex-1 overflow-y-auto px-6 py-6 relative z-10">
            <AnimatePresence>
              {messages.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center h-full text-center gap-6"
                >
                  <div className="relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-purple-500/30 to-blue-500/30 blur-2xl rounded-full" />
                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center shadow-xl">
                      <Sparkles size={32} className="text-white" />
                    </div>
                  </div>
                  <div className="max-w-sm">
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent mb-3">
                      Nexo AI
                    </h2>
                    <p className="text-white/80 whitespace-pre-line leading-relaxed">{welcomeMessage}</p>
                  </div>
                </motion.div>
              ) : (
                <div className="space-y-6">
                  {messages.map((msg) => (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-6 py-4 rounded-2xl text-sm ${
                          msg.role === 'user'
                            ? 'bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-lg'
                            : 'bg-white/10 backdrop-blur-xl text-white/90 border border-white/10 rounded-bl-3xl shadow-lg'
                        }`}
                      >
                        {msg.role === 'assistant' ? (
                          <div className="prose prose-invert max-w-none">
                            {renderAIMessage(msg.content)}
                          </div>
                        ) : (
                          <span className="whitespace-pre-wrap">{msg.content}</span>
                        )}
                        {msg.isStreaming && (
                          <div className="flex items-center gap-1 mt-2">
                            <span className="inline-block w-1.5 h-4 bg-white/40 animate-pulse rounded-full" />
                            <span className="inline-block w-1.5 h-4 bg-white/40 animate-pulse rounded-full animation-delay-100" />
                            <span className="inline-block w-1.5 h-4 bg-white/40 animate-pulse rounded-full animation-delay-200" />
                          </div>
                        )}
                        
                        {/* Кнопка пересылки для сообщений AI */}
                        {msg.role === 'assistant' && (
                          <button
                            onClick={() => {
                              setMessageToForward(msg);
                              loadChatsForForward();
                              setShowForwardModal(true);
                            }}
                            className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-xl bg-black/80 text-white/80 hover:text-white backdrop-blur-sm"
                            title="Переслать сообщение"
                          >
                            <Forward size={14} />
                          </button>
                        )}
                      </div>
                    </motion.div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* ПОЛЕ ВВОДА */}
          <div className="px-3 py-3 flex-shrink-0 relative z-10">
            <div className="bg-[#1a1a25] border border-white/5 rounded-2xl px-3 py-2 flex items-end gap-2 focus-within:border-nexo-500/30 transition-colors">
              {/* Голос */}
              <button
                onClick={toggleRecording}
                className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center transition-all ${
                  isRecording ? 'bg-red-500/20 text-red-400' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {isRecording ? <Mic size={16} /> : <MicOff size={16} />}
              </button>

              {/* Textarea */}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Сообщение..."
                rows={1}
                className="flex-1 bg-transparent text-white text-sm placeholder-zinc-500 resize-none outline-none py-1.5 max-h-24"
                style={{ minHeight: '36px' }}
              />

              {/* Send */}
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isSending}
                className="w-9 h-9 rounded-full bg-nexo-500 flex items-center justify-center flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-nexo-600 transition-colors"
              >
                {isSending ? <Loader2 size={16} className="animate-spin text-white" /> : <Send size={16} className="text-white" />}
              </button>
            </div>

            {isRecording && (
              <motion.p initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                className="text-xs text-red-400 mt-2 text-center">
                🔴 Запись голоса...
              </motion.p>
            )}
          </div>
        </div>
      </div>

      {/* ====== MODAL ПЕРЕСЫЛКИ ====== */}
      <AnimatePresence>
        {showForwardModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowForwardModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-[#1a1a25] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-base font-semibold text-white">Переслать сообщение</h3>
                <button onClick={() => setShowForwardModal(false)} className="text-zinc-400 hover:text-white">
                  <X size={18} />
                </button>
              </div>
              
              <div className="max-h-80 overflow-y-auto p-2 space-y-1">
                {chatsForForward.map((chat) => (
                  <button
                    key={chat.id}
                    onClick={() => forwardMessage(chat.id)}
                    className="w-full p-3 rounded-xl hover:bg-white/5 flex items-center gap-3 text-left transition-colors"
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-nexo-500/20 to-purple-600/20 flex items-center justify-center flex-shrink-0">
                      <MessageSquare size={18} className="text-nexo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-white truncate">{chat.name || chat.type === 'personal' ? 'Личный чат' : chat.type}</h4>
                      <p className="text-xs text-zinc-500 truncate">{chat.description || ''}</p>
                    </div>
                  </button>
                ))}
                
                {chatsForForward.length === 0 && (
                  <div className="text-center py-8 text-zinc-500 text-sm">
                    Нет доступных чатов
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
