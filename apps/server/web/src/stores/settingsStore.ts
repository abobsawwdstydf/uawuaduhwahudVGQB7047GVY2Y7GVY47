import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '../lib/api';

export interface UserSettings {
  notifyAll: boolean;
  notifyMessages: boolean;
  notifyCalls: boolean;
  notifyFriends: boolean;
  theme: string;
  chatTheme: string;
  language: string;
  fontSize: string;
  reducedMotion: boolean;
  compactMode: boolean;
  lastSync: number;
}

interface SettingsState extends UserSettings {
  setNotifyAll: (v: boolean) => void;
  setNotifyMessages: (v: boolean) => void;
  setNotifyCalls: (v: boolean) => void;
  setNotifyFriends: (v: boolean) => void;
  setTheme: (v: string) => void;
  setChatTheme: (v: string) => void;
  setLanguage: (v: string) => void;
  setFontSize: (v: string) => void;
  setReducedMotion: (v: boolean) => void;
  setCompactMode: (v: boolean) => void;
  syncFromServer: () => Promise<void>;
  syncToServer: () => Promise<void>;
  isOnline: boolean;
  setOnline: (v: boolean) => void;
}

const defaultSettings: UserSettings = {
  notifyAll: true,
  notifyMessages: true,
  notifyCalls: true,
  notifyFriends: true,
  theme: 'dark',
  chatTheme: 'midnight',
  language: 'ru',
  fontSize: 'medium',
  reducedMotion: false,
  compactMode: false,
  lastSync: 0,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...defaultSettings,
      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,

      setNotifyAll: (v) => { set({ notifyAll: v }); get().syncToServer(); },
      setNotifyMessages: (v) => { set({ notifyMessages: v }); get().syncToServer(); },
      setNotifyCalls: (v) => { set({ notifyCalls: v }); get().syncToServer(); },
      setNotifyFriends: (v) => { set({ notifyFriends: v }); get().syncToServer(); },
      setTheme: (v) => set({ theme: v }),
      setChatTheme: (v) => set({ chatTheme: v }),
      setLanguage: (v) => set({ language: v }),
      setFontSize: (v) => set({ fontSize: v }),
      setReducedMotion: (v) => set({ reducedMotion: v }),
      setCompactMode: (v) => set({ compactMode: v }),
      setOnline: (v) => set({ isOnline: v }),

      syncFromServer: async () => {
        try {
          const serverSettings = await api.getSettings();
          const lastSync = get().lastSync;
          // Only sync if server data is newer
          if (serverSettings.updatedAt && new Date(serverSettings.updatedAt).getTime() > lastSync) {
            set({
              notifyAll: serverSettings.notifyAll ?? true,
              notifyMessages: serverSettings.notifyMessages ?? true,
              notifyCalls: serverSettings.notifyCalls ?? true,
              notifyFriends: serverSettings.notifyFriends ?? true,
              theme: serverSettings.theme ?? 'dark',
              chatTheme: serverSettings.chatTheme ?? 'midnight',
              language: serverSettings.language ?? 'ru',
              fontSize: serverSettings.fontSize ?? 'medium',
              reducedMotion: serverSettings.reducedMotion ?? false,
              compactMode: serverSettings.compactMode ?? false,
              lastSync: Date.now(),
            });
          }
        } catch (e) {
          console.warn('[Settings] Sync from server failed:', e);
        }
      },

      syncToServer: async () => {
        const state = get();
        try {
          await api.updateSettings({
            notifyAll: state.notifyAll,
            notifyMessages: state.notifyMessages,
            notifyCalls: state.notifyCalls,
            notifyFriends: state.notifyFriends,
            theme: state.theme,
            chatTheme: state.chatTheme,
            language: state.language,
            fontSize: state.fontSize,
            reducedMotion: state.reducedMotion,
            compactMode: state.compactMode,
          });
          set({ lastSync: Date.now() });
        } catch (e) {
          console.warn('[Settings] Sync to server failed:', e);
        }
      },
    }),
    {
      name: 'nexo-settings-storage',
    }
  )
);

// Listen for online/offline events
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useSettingsStore.getState().setOnline(true);
    // Sync when back online
    useSettingsStore.getState().syncFromServer();
  });
  window.addEventListener('offline', () => {
    useSettingsStore.getState().setOnline(false);
  });
}