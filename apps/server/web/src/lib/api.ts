import type { User, UserBasic, UserPresence, Chat, Message, MediaItem, StoryGroup, FriendRequest, FriendWithId, FriendshipStatus } from './types';
import { API_URL } from '../config';

// Use API_URL from config for mobile/desktop apps
// Use relative path for web (proxied through Vite)
const API_BASE = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
  ? (API_URL ? API_URL + '/api' : '/api')
  : '/api';

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit & { timeout?: number } = {}): Promise<T> {
    const { timeout = 30_000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timer = timeout > 0 ? setTimeout(() => controller.abort(), timeout) : undefined;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...fetchOptions.headers,
    };

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Время ожидания запроса истекло');
      }
      throw err;
    }
    clearTimeout(timer);

    if (!response.ok) {
      // 403 = токен недействителен — автоматически выходим
      if (response.status === 403) {
        localStorage.removeItem('nexo_token');
        this.token = null;
        window.location.href = '/';
      }
      const error = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(error.error || 'Ошибка запроса');
    }

    return response.json();
  }

  // Авторизация
  async login(phone: string, password: string) {
    return this.request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });
  }

  async register(data: {
    username: string;
    displayName?: string;
    phone: string;
    password: string;
    bio?: string;
    birthday?: string;
    avatar?: File;
  }) {
    const formData = new FormData();
    formData.append('username', data.username);
    if (data.displayName) formData.append('displayName', data.displayName);
    formData.append('phone', data.phone);
    formData.append('password', data.password);
    if (data.bio) formData.append('bio', data.bio);
    if (data.birthday) formData.append('birthday', data.birthday);
    if (data.avatar) formData.append('avatar', data.avatar);

    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Ошибка сервера' }));
      throw new Error(error.error || 'Ошибка регистрации');
    }

    return response.json();
  }

  async checkUsername(username: string) {
    return this.request<{ available: boolean; reason?: string }>(`/auth/check-username?username=${encodeURIComponent(username)}`);
  }

  async checkPhone(phone: string) {
    return this.request<{ available: boolean }>(`/auth/check-phone?phone=${encodeURIComponent(phone)}`);
  }

  async getMe() {
    return this.request<{ user: User }>('/auth/me');
  }

  // \u041f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438
  async searchUsers(query: string) {
    return this.request<UserPresence[]>(`/users/search?q=${encodeURIComponent(query)}`);
  }

  async searchChannels(query: string) {
    return this.request<Chat[]>(`/users/channels/search?q=${encodeURIComponent(query)}`);
  }

  async getUser(id: string) {
    return this.request<User>(`/users/${id}`);
  }

  async updateProfile(data: { displayName?: string; bio?: string; birthday?: string; username?: string }) {
    return this.request<User>('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadAvatar(file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const response = await fetch(`${API_BASE}/users/avatar`, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error('Ошибка загрузки аватара');
    return response.json() as Promise<User>;
  }

  async removeAvatar() {
    return this.request<User>('/users/avatar', { method: 'DELETE' });
  }

  async searchMessages(query: string, chatId?: string) {
    const params = new URLSearchParams({ q: query });
    if (chatId) params.append('chatId', chatId);
    return this.request<Message[]>(`/users/messages/search?${params}`);
  }

  // \u0427\u0430\u0442\u044b
  async getChats() {
    return this.request<Chat[]>('/chats');
  }

  async getChat(id: string) {
    return this.request<Chat>(`/chats/${id}`);
  }

  async createPersonalChat(userId: string) {
    return this.request<Chat>('/chats/personal', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
  }

  async createGroupChat(name: string, memberIds: string[]) {
    return this.request<Chat>('/chats/group', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
    });
  }

  async createChannel(name: string, username: string, description?: string, avatarUrl?: string) {
    return this.request<Chat>('/chats/channel', {
      method: 'POST',
      body: JSON.stringify({ name, username, description, avatar: avatarUrl }),
    });
  }

  async getChannelByUsername(username: string) {
    return this.request<Chat>(`/chats/join/${encodeURIComponent(username)}`);
  }

  async joinChannel(username: string) {
    return this.request<Chat>(`/chats/join/${encodeURIComponent(username)}`, {
      method: 'POST',
    });
  }

  // \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f
  async getMessages(chatId: string, cursor?: string) {
    const params = cursor ? `?cursor=${cursor}` : '';
    return this.request<Message[]>(`/messages/chat/${chatId}${params}`);
  }

  async uploadFile(file: File) {
    const formData = new FormData();
    formData.append('files', file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300_000); // 5 минут для больших файлов
    const response = await fetch(`${API_BASE}/messages/upload`, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Ошибка загрузки файла' }));
      throw new Error(error.error || `Ошибка загрузки: ${response.status}`);
    }
    const result = await response.json();

    // Handle response formats:
    // 1. Array: [{ fileId, url, ... }] (old format)
    // 2. Object: { files: [{ fileId, url, ... }] } (new format)
    // 3. Object: { fileId, url, ... } (single file)
    if (Array.isArray(result)) return result[0];
    if (result.files && Array.isArray(result.files)) return result.files[0];
    if (result.fileId || result.url) return result;

    console.error('[uploadFile] Unexpected response:', result);
    throw new Error('Неожиданный ответ сервера при загрузке');
  }

  // \u0413\u0440\u0443\u043f\u043f\u044b
  async updateGroup(chatId: string, data: { name?: string; description?: string }) {
    return this.request<Chat>(`/chats/${chatId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async uploadGroupAvatar(chatId: string, file: File) {
    const formData = new FormData();
    formData.append('avatar', file);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    const response = await fetch(`${API_BASE}/chats/${chatId}/avatar`, {
      method: 'POST',
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error('\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u0430\u0432\u0430\u0442\u0430\u0440\u0430');
    return response.json() as Promise<Chat>;
  }

  async removeGroupAvatar(chatId: string) {
    return this.request<Chat>(`/chats/${chatId}/avatar`, { method: 'DELETE' });
  }

  async addGroupMembers(chatId: string, userIds: string[]) {
    return this.request<Chat>(`/chats/${chatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  }

  async removeGroupMember(chatId: string, userId: string) {
    return this.request<Chat>(`/chats/${chatId}/members/${userId}`, {
      method: 'DELETE',
    });
  }

  async clearChat(chatId: string) {
    return this.request<{ message: string }>(`/chats/${chatId}/clear`, { method: 'POST' });
  }

  async deleteChat(chatId: string) {
    return this.request<{ message: string }>(`/chats/${chatId}`, { method: 'DELETE' });
  }

  async togglePinChat(chatId: string) {
    return this.request<{ isPinned: boolean }>(`/chats/${chatId}/pin`, { method: 'POST' });
  }

  async getSharedMedia(chatId: string, type: 'media' | 'files' | 'links') {
    return this.request<Message[]>(`/messages/chat/${chatId}/shared?type=${type}`);
  }

  // ICE серверы для WebRTC
  async getIceServers() {
    return this.request<{ iceServers: RTCIceServer[] }>('/ice-servers');
  }

  // Stories
  async getStories() {
    return this.request<StoryGroup[]>('/stories');
  }

  async createStory(data: { type: string; mediaUrl?: string; content?: string; bgColor?: string }) {
    return this.request<{ id: string }>('/stories', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async viewStory(storyId: string) {
    return this.request<{ message: string }>(`/stories/${storyId}/view`, { method: 'POST' });
  }

  async deleteStory(storyId: string) {
    return this.request<{ message: string }>(`/stories/${storyId}`, { method: 'DELETE' });
  }

  async getStoryViewers(storyId: string) {
    return this.request<Array<{ userId: string; username: string; displayName: string; avatar: string | null; viewedAt: string }>>(`/stories/${storyId}/viewers`);
  }

  // Favorites chat
  async getOrCreateFavorites() {
    return this.request<Chat>('/chats/favorites', { method: 'POST' });
  }

  // Friends
  async getFriends() {
    return this.request<FriendWithId[]>('/friends');
  }

  async getFriendRequests() {
    return this.request<FriendRequest[]>('/friends/requests');
  }

  async getOutgoingRequests() {
    return this.request<FriendRequest[]>('/friends/outgoing');
  }

  async getFriendshipStatus(userId: string) {
    return this.request<FriendshipStatus>(`/friends/status/${userId}`);
  }

  async sendFriendRequest(friendId: string) {
    return this.request<{ status: string }>('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friendId }),
    });
  }

  async acceptFriendRequest(friendshipId: string) {
    return this.request<{ id: string }>(`/friends/${friendshipId}/accept`, { method: 'POST' });
  }

  async declineFriendRequest(friendshipId: string) {
    return this.request<{ success: boolean }>(`/friends/${friendshipId}/decline`, { method: 'POST' });
  }

  async removeFriend(friendshipId: string) {
    return this.request<{ success: boolean }>(`/friends/${friendshipId}`, { method: 'DELETE' });
  }

  // Call history
  async getCallHistory(limit?: number) {
    return this.request<Array<{
      id: string;
      callerId: string;
      calleeId: string;
      chatId: string | null;
      type: 'voice' | 'video' | 'group';
      status: 'completed' | 'missed' | 'declined' | 'failed';
      duration: number;
      createdAt: string;
      caller: UserBasic;
      callee: UserBasic | null;
    }>>(`/call-logs${limit ? `?limit=${limit}` : ''}`);
  }

  async createCallLog(data: {
    calleeId: string;
    chatId?: string;
    type?: 'voice' | 'video' | 'group';
    status?: 'completed' | 'missed' | 'declined' | 'failed';
    duration?: number;
  }) {
    return this.request<{
      id: string;
      callerId: string;
      calleeId: string;
      chatId: string | null;
      type: 'voice' | 'video' | 'group';
      status: 'completed' | 'missed' | 'declined' | 'failed';
      duration: number;
      createdAt: string;
      caller: UserBasic;
      callee: UserBasic | null;
    }>('/call-logs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Channel post views
  async markPostViewed(messageId: string) {
    return this.request<{ viewCount: number }>(`/messages/${messageId}/view`, {
      method: 'POST',
    });
  }

  // Channel analytics
  async getChannelAnalytics(channelId: string) {
    return this.request<{
      subscribers: number;
      totalViews: number;
      posts: number;
      recentPosts: Array<{
        id: string;
        content: string | null;
        createdAt: string;
        viewCount: number;
        reactions: number;
      }>;
      topPosts: Array<{
        id: string;
        content: string | null;
        createdAt: string;
        viewCount: number;
        reactions: number;
      }>;
    }>(`/chats/${channelId}/analytics`);
  }

  async saveWebPushSubscription(subscription: PushSubscription) {
    return this.request<{ success: boolean }>('/users/push-subscription', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    });
  }

  async getUserChannels(userId: string) {
    return this.request<Chat[]>(`/users/${userId}/channels`);
  }

  async pinChannel(channelId: string) {
    return this.request<User>('/users/pin-channel', {
      method: 'PUT',
      body: JSON.stringify({ channelId }),
    });
  }

  async unpinChannel() {
    return this.request<User>('/users/pin-channel', {
      method: 'DELETE',
    });
  }

  async getNotificationSettings() {
    return this.request<{
      notifyAll: boolean;
      notifyMessages: boolean;
      notifyCalls: boolean;
      notifyFriends: boolean;
    }>('/users/notifications');
  }

  async updateNotificationSettings(settings: {
    notifyAll?: boolean;
    notifyMessages?: boolean;
    notifyCalls?: boolean;
    notifyFriends?: boolean;
  }) {
    return this.request('/users/notifications', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // Devices
  async getDevices() {
    return this.request<Array<{
      id: string;
      deviceName: string;
      browser: string;
      os: string;
      ip: string;
      location: string;
      lastActive: string;
      isCurrent: boolean;
      addedAt: string;
    }>>('/users/devices');
  }

  async terminateDevice(deviceId: string) {
    return this.request<{ success: boolean }>(`/users/devices/${deviceId}`, {
      method: 'DELETE',
    });
  }

  async terminateAllDevices() {
    return this.request<{ success: boolean; count: number }>('/users/devices/terminate-all', {
      method: 'POST',
    });
  }

  // Threads
  async createThread(chatId: string, messageId: string, title?: string) {
    return this.request<{ id: string; messageId: string; chatId: string; title: string | null }>(`/threads/chat/${chatId}/thread`, {
      method: 'POST',
      body: JSON.stringify({ messageId, title }),
    });
  }

  async getThreads(chatId: string) {
    return this.request<Array<{ id: string; messageId: string; chatId: string; title: string | null; replyCount: number; message: Message }>>(`/threads/chat/${chatId}`);
  }

  async getThreadMessages(threadId: string) {
    return this.request<Message[]>(`/threads/thread/${threadId}/messages`);
  }

  async deleteThread(threadId: string) {
    return this.request<{ success: boolean }>(`/threads/thread/${threadId}`, {
      method: 'DELETE',
    });
  }

// Settings sync
  async getSettings() {
    return this.request<{
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
      hideStoryViews: boolean;
      updatedAt: string;
    }>('/users/settings');
  }

  async updateSettings(settings: {
    notifyAll?: boolean;
    notifyMessages?: boolean;
    notifyCalls?: boolean;
    notifyFriends?: boolean;
    theme?: string;
    chatTheme?: string;
    language?: string;
    fontSize?: string;
    reducedMotion?: boolean;
    compactMode?: boolean;
    hideStoryViews?: boolean;
  }) {
    return this.request('/users/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }
}

export const api = new ApiClient();
