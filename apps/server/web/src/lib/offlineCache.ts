import { openDB, DBSchema, IDBPDatabase } from 'idb';
import type { Chat, Message } from './types';

interface NexoDB extends DBSchema {
  chats: {
    key: string;
    value: Chat;
    indexes: { 'by-updated': string };
  };
  messages: {
    key: string;
    value: Message & { chatId: string };
    indexes: { 'by-chat': string };
  };
  pendingActions: {
    key: string;
    value: {
      id: string;
      type: 'message' | 'reaction' | 'read';
      data: any;
      timestamp: number;
    };
  };
  settings: {
    key: string;
    value: any;
  };
}

let db: IDBPDatabase<NexoDB> | null = null;

export async function initOfflineDB(): Promise<IDBPDatabase<NexoDB>> {
  if (db) return db;
  
  db = await openDB('nexo-offline', 1, {
    upgrade(database) {
      const chatStore = database.createObjectStore('chats', { keyPath: 'id' });
      chatStore.createIndex('by-updated', 'updatedAt');
      
      const messageStore = database.createObjectStore('messages', { keyPath: 'id' });
      messageStore.createIndex('by-chat', 'chatId');
      
      database.createObjectStore('pendingActions', { keyPath: 'id' });
      database.createObjectStore('settings', { keyPath: 'key' });
    },
  });
  
  console.log('[Offline DB] Initialized');
  return db;
}

export async function cacheChats(chats: Chat[]): Promise<void> {
  const database = await initOfflineDB();
  const tx = database.transaction('chats', 'readwrite');
  
  await Promise.all([
    ...chats.map(chat => tx.store.put(chat)),
    tx.done,
  ]);
}

export async function getCachedChats(): Promise<Chat[]> {
  const database = await initOfflineDB();
  return database.getAll('chats');
}

export async function cacheMessages(chatId: string, messages: Message[]): Promise<void> {
  const database = await initOfflineDB();
  const tx = database.transaction('messages', 'readwrite');
  
  await Promise.all([
    ...messages.map(msg => tx.store.put({ ...msg, chatId })),
    tx.done,
  ]);
}

export async function getCachedMessages(chatId: string): Promise<Message[]> {
  const database = await initOfflineDB();
  return database.getAllFromIndex('messages', 'by-chat', chatId);
}

export async function addPendingAction(action: NexoDB['pendingActions']['value']): Promise<void> {
  const database = await initOfflineDB();
  await database.put('pendingActions', action);
}

export async function getPendingActions(): Promise<NexoDB['pendingActions']['value'][]> {
  const database = await initOfflineDB();
  return database.getAll('pendingActions');
}

export async function clearPendingAction(id: string): Promise<void> {
  const database = await initOfflineDB();
  await database.delete('pendingActions', id);
}

export async function cacheSetting(key: string, value: any): Promise<void> {
  const database = await initOfflineDB();
  await database.put('settings', { key, value });
}

export async function getCachedSetting(key: string): Promise<any> {
  const database = await initOfflineDB();
  const result = await database.get('settings', key);
  return result?.value;
}

export async function syncPendingActions(api: any): Promise<void> {
  const actions = await getPendingActions();
  
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'message':
          await api.sendMessage(action.data.chatId, action.data.content, action.data.type);
          break;
        case 'reaction':
          if (action.data.remove) {
            await api.removeReaction(action.data.messageId, action.data.chatId, action.data.emoji);
          } else {
            await api.addReaction(action.data.messageId, action.data.chatId, action.data.emoji);
          }
          break;
        case 'read':
          await api.markMessagesRead(action.data.chatId, action.data.messageIds);
          break;
      }
      await clearPendingAction(action.id);
    } catch (e) {
      console.warn('[Offline] Failed to sync action:', action.id, e);
    }
  }
}

export async function clearAllCache(): Promise<void> {
  const database = await initOfflineDB();
  await Promise.all([
    database.clear('chats'),
    database.clear('messages'),
    database.clear('pendingActions'),
  ]);
}