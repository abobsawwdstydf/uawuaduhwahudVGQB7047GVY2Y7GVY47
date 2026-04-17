/* eslint-disable no-restricted-globals */

// Unified Notification Service Worker
// Works with both Firebase (mobile) and Web Push (desktop)

const CACHE_NAME = 'nexo-notification-v1';

// Handle push events
self.addEventListener('push', (event) => {
  console.log('[Notification SW] Push received:', event);

  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      try {
        const text = event.data.text();
        data = JSON.parse(text);
      } catch {
        data = { title: 'Nexo', body: event.data.text() };
      }
    }
  }

  const notification = data.notification || data;
  const { title, body, icon, badge, image, data: notificationData } = notification;

  const notificationOptions = {
    body: body || 'Новое сообщение',
    icon: icon || '/logo.png',
    badge: badge || '/logo.png',
    image: image || undefined,
    vibrate: [200, 100, 200, 100, 200],
    tag: notificationData?.chatId || 'nexo-default',
    renotify: true,
    data: {
      dateOfArrival: Date.now(),
      primaryKey: Date.now(),
      ...notificationData
    },
    requireInteraction: notificationData?.type === 'incoming_call',
    silent: false,
    actions: notificationData?.type === 'incoming_call' ? [
      { action: 'answer_call', title: 'Принять', icon: '/logo.png' },
      { action: 'decline_call', title: 'Отклонить' }
    ] : [
      { action: 'open', title: 'Открыть', icon: '/logo.png' },
      { action: 'reply', title: 'Ответить', icon: '/logo.png' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title || 'Nexo Messenger', notificationOptions)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[Notification SW] Notification click:', event);
  event.notification.close();

  const { action, data } = event.notification;
  let url = '/';

  // Handle call actions
  if (action === 'answer_call' || action === 'decline_call') {
    url = `/?call_action=${action === 'answer_call' ? 'incoming' : 'declined'}&callerId=${data.callerId || ''}&callType=${data.callType || 'voice'}`;
  }
  // Handle reply action - just open chat
  else if (action === 'reply') {
    url = `/?chat=${data.chatId}`;
  }
  // Build URL based on notification type
  else if (data?.type === 'incoming_call') {
    url = `/?call_action=incoming&callerId=${data.callerId || ''}&callType=${data.callType || 'voice'}`;
  } else if (data?.chatId) {
    url = `/?chat=${data.chatId}`;
  } else if (data?.friendRequestId) {
    url = `/?friend_request=${data.friendRequestId}`;
  } else if (data?.callAction) {
    url = `/?call_action=${data.callAction}&callerId=${data.callerId || ''}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Try to focus existing window
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && client.visibilityState === 'visible') {
          client.postMessage({
            type: 'notification_click',
            action,
            data
          });
          return client.focus();
        }
      }

      // Focus any existing window
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          return client.focus().then(() => {
            client.postMessage({
              type: 'notification_click',
              action,
              data
            });
          });
        }
      }

      // Open new window
      return clients.openWindow(url);
    })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.delete(CACHE_NAME)
    );
  }
});

// Install event - cache assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/logo.png'
      ]);
    })
  );
});

// Activate event
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  return self.clients.claim();
});
