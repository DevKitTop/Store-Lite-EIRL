'use strict';

const DEFAULT_TITLE = 'Nueva notificación';
const DEFAULT_BODY = 'Tienes una nueva novedad en Store Lite.';
const DEFAULT_PATH = '/';
const PUSH_CONFIG_URL = '/api/push/config';
const PUSH_SUBSCRIPTIONS_URL = '/api/push/subscriptions';

function boundedString(value, maxLength) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return DEFAULT_PATH;
  }

  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return DEFAULT_PATH;
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_PATH;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_PATH;
  }
}

function readPayload(event) {
  if (!event || !event.data || typeof event.data.json !== 'function') return {};
  try {
    const payload = event.data.json();
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

async function handlePush(event) {
  const payload = readPayload(event);
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const tag = boundedString(payload.tag, 100) || boundedString(data.notificationId, 100);

  await self.registration.showNotification(boundedString(payload.title, 120) || DEFAULT_TITLE, {
    body: boundedString(payload.body, 300) || DEFAULT_BODY,
    data: { url: safePath(data.url) },
    tag,
    renotify: Boolean(tag),
  });
}

async function handleNotificationClick(event) {
  const notification = event.notification;
  if (notification && typeof notification.close === 'function') notification.close();

  const data = notification && notification.data && typeof notification.data === 'object'
    ? notification.data
    : {};
  const targetUrl = new URL(safePath(data.url), self.location.origin).href;
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const client of clientList) {
    if (client.url === targetUrl && typeof client.focus === 'function') {
      await client.focus();
      return;
    }
  }

  if (typeof self.clients.openWindow === 'function') {
    await self.clients.openWindow(targetUrl);
    return;
  }

  for (const client of clientList) {
    if (typeof client.focus === 'function') {
      await client.focus();
      return;
    }
  }
}

async function handlePushSubscriptionChange() {
  try {
    const configResponse = await fetch(PUSH_CONFIG_URL, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!configResponse.ok) return;

    const config = await configResponse.json();
    const publicKey = config && typeof config.publicKey === 'string' ? config.publicKey.trim() : '';
    if (!publicKey) return;

    const subscription = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
    if (!subscription) return;

    const serialized = typeof subscription.toJSON === 'function'
      ? subscription.toJSON()
      : { endpoint: subscription.endpoint, keys: subscription.keys };
    if (!serialized || typeof serialized.endpoint !== 'string') return;

    await fetch(PUSH_SUBSCRIPTIONS_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: serialized }),
    });
  } catch {
    // Rotation is best-effort. The app reconciles on the next authenticated session.
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(handleNotificationClick(event));
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(handlePushSubscriptionChange(event));
});
