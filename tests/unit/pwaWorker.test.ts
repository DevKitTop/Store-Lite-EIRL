import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, test, vi } from 'vitest';

const SW_PATH = path.resolve(process.cwd(), 'public/sw.js');

type Handler = (event: Record<string, unknown>) => void | Promise<void>;

function loadWorker() {
  const code = readFileSync(SW_PATH, 'utf8');
  const listeners = new Map<string, Handler>();
  const showNotification = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue([]);
  const openWindow = vi.fn().mockResolvedValue(null);
  const subscribe = vi.fn();
  const fetchMock = vi.fn();
  const consoleMock = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  const self = {
    addEventListener: vi.fn((type: string, handler: Handler) => listeners.set(type, handler)),
    location: {
      origin: 'https://app.example.com',
      href: 'https://app.example.com/sw.js',
      pathname: '/sw.js',
    },
    registration: {
      showNotification,
      pushManager: { subscribe },
    },
    clients: { matchAll, openWindow },
  };

  // The worker is evaluated here on purpose: it is a static browser script, not a module.
  // eslint-disable-next-line sonarjs/code-eval
  vm.runInNewContext(code, {
    self,
    URL,
    fetch: fetchMock,
    console: consoleMock,
    setTimeout,
    clearTimeout,
  });

  return { listeners, showNotification, matchAll, openWindow, subscribe, fetchMock, consoleMock };
}

function makeEvent(data?: unknown) {
  const waitUntil = vi.fn();
  return {
    event: {
      waitUntil,
      ...(data === undefined ? {} : { data: { json: () => data } }),
    },
    settle: async () => {
      const promise = waitUntil.mock.calls[0]?.[0];
      if (promise) await promise;
    },
  };
}

describe('public/sw.js', () => {
  test('registers only push and click handlers, with no fetch interception', () => {
    const worker = loadWorker();
    expect(worker.listeners.has('install')).toBe(true);
    expect(worker.listeners.has('activate')).toBe(true);
    expect(worker.listeners.has('push')).toBe(true);
    expect(worker.listeners.has('notificationclick')).toBe(true);
    expect(worker.listeners.has('pushsubscriptionchange')).toBe(true);
    expect(worker.listeners.has('fetch')).toBe(false);
  });

  test('shows a generic notification for a missing or malformed payload', async () => {
    const worker = loadWorker();
    const { event, settle } = makeEvent();
    worker.listeners.get('push')!(event);
    await settle();

    expect(worker.showNotification).toHaveBeenCalledTimes(1);
    const [title, options] = worker.showNotification.mock.calls[0];
    expect(title).toBe('Nueva notificación');
    expect(options.body).toBe('Tienes una nueva novedad en Store Lite.');
    expect(options.data.url).toBe('/');
  });

  test('uses generic payload fields and rejects an external click URL', async () => {
    const worker = loadWorker();
    const { event, settle } = makeEvent({
      title: 'Pedido',
      body: 'Novedad de tu tienda',
      tag: 'pedidos-1',
      data: { url: 'https://evil.example/steal', category: 'pedidos', notificationId: 'n-1' },
    });
    worker.listeners.get('push')!(event);
    await settle();

    const [title, options] = worker.showNotification.mock.calls[0];
    expect(title).toBe('Pedido');
    expect(options.body).toBe('Novedad de tu tienda');
    expect(options.tag).toBe('pedidos-1');
    expect(options.data.url).toBe('/');
  });

  test('focuses an existing client already on the target route', async () => {
    const worker = loadWorker();
    const focus = vi.fn();
    worker.matchAll.mockResolvedValueOnce([
      { url: 'https://app.example.com/notifications', focus },
    ]);
    const { event, settle } = makeEvent();
    const notification = { close: vi.fn(), data: { url: '/notifications' } };
    worker.listeners.get('notificationclick')!({ ...event, notification });
    await settle();

    expect(notification.close).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  test('opens a same-origin path in a new client when no match exists', async () => {
    const worker = loadWorker();
    const { event, settle } = makeEvent();
    const notification = { close: vi.fn(), data: { url: '/notifications' } };
    worker.listeners.get('notificationclick')!({ ...event, notification });
    await settle();

    expect(worker.openWindow).toHaveBeenCalledWith('https://app.example.com/notifications');
  });

  test('drops an absolute external URL from notification click data', async () => {
    const worker = loadWorker();
    const { event, settle } = makeEvent();
    const notification = { close: vi.fn(), data: { url: 'https://evil.example/steal' } };
    worker.listeners.get('notificationclick')!({ ...event, notification });
    await settle();

    expect(worker.openWindow).toHaveBeenCalledWith('https://app.example.com/');
  });

  test('rotates a subscription through the public config and T2.2 API', async () => {
    const worker = loadWorker();
    worker.fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ publicKey: 'public-vapid-key' }),
      })
      .mockResolvedValueOnce({ ok: true });
    worker.subscribe.mockResolvedValueOnce({
      toJSON: () => ({
        endpoint: 'https://push.example.com/sub-1',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    });

    const { event, settle } = makeEvent();
    worker.listeners.get('pushsubscriptionchange')!(event);
    await settle();

    expect(worker.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: 'public-vapid-key',
    });
    const [url, options] = worker.fetchMock.mock.calls[1];
    expect(url).toBe('/api/push/subscriptions');
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('include');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(options.body).subscription.endpoint).toBe('https://push.example.com/sub-1');
    expect(worker.consoleMock.error).not.toHaveBeenCalled();
  });

  test('handles an unavailable config endpoint without retry loops or secret logging', async () => {
    const worker = loadWorker();
    worker.fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    const { event, settle } = makeEvent();

    await expect(
      (async () => {
        worker.listeners.get('pushsubscriptionchange')!(event);
        await settle();
      })(),
    ).resolves.toBeUndefined();

    expect(worker.subscribe).not.toHaveBeenCalled();
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(worker.consoleMock.error).not.toHaveBeenCalled();
  });
});
