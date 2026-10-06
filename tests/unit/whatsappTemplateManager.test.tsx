import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WhatsAppTemplateManager,
  baseTemplateLabel,
  categoryLabel,
  formatTemplateDate,
  isBaseTemplateCreated,
  templateStatusLabel,
  type WhatsAppTemplate,
} from '@/features/whatsapp/components/WhatsAppTemplateManager';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

function createTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    channelId: CHANNEL_ID,
    name: 'order_confirmed',
    category: 'utility',
    language: 'es',
    body: 'Cuerpo del template',
    metaStatus: 'pending',
    metaTemplateId: 'ycloud-1',
    createdAt: '2026-09-18T12:00:00.000Z',
    ...overrides,
  };
}

interface StubRoute {
  status?: number;
  body?: unknown;
}

type RouteFactory = () => StubRoute;

/**
 * Stub global fetch with `METHOD url-prefix` routing.
 * Route values may be plain objects (static) or factories evaluated per call.
 */
function stubFetch(routes: Record<string, StubRoute | RouteFactory>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const matchingKey = Object.keys(routes).find((key) => {
        const [keyMethod, keyPrefix] = key.split(' ', 2);
        return keyMethod === method && keyPrefix && url.startsWith(keyPrefix);
      });
      if (!matchingKey) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      }
      const entry = routes[matchingKey];
      const route: StubRoute =
        typeof entry === 'function' ? entry() : entry;
      return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200 });
    }),
  );
}

function renderManager(open = true) {
  return render(
    <WhatsAppTemplateManager channelId={CHANNEL_ID} open={open} onClose={() => {}} />,
  );
}

// ── Pure helpers ─────────────────────────────────────────────

describe('templateStatusLabel', () => {
  it('maps every meta status to its Spanish label', () => {
    expect(templateStatusLabel('approved')).toBe('Aprobado');
    expect(templateStatusLabel('pending')).toBe('Pendiente');
    expect(templateStatusLabel('rejected')).toBe('Rechazado');
  });
});

describe('categoryLabel', () => {
  it('maps every template category to its Spanish label', () => {
    expect(categoryLabel('utility')).toBe('Utilidad');
    expect(categoryLabel('marketing')).toBe('Marketing');
    expect(categoryLabel('authentication')).toBe('Autenticación');
  });
});

describe('formatTemplateDate', () => {
  it('formats an ISO date as DD/MM/YYYY', () => {
    expect(formatTemplateDate('2026-09-18T12:00:00.000Z')).toBe('18/09/2026');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatTemplateDate('not-a-date')).toBe('');
  });
});

describe('baseTemplateLabel', () => {
  it('returns a friendly Spanish label for known base templates', () => {
    expect(baseTemplateLabel('order_confirmed')).toBe('Pedido confirmado');
    expect(baseTemplateLabel('payment_reminder')).toBe('Recordatorio de pago');
  });

  it('falls back to the raw name for unknown templates', () => {
    expect(baseTemplateLabel('custom_alert')).toBe('custom_alert');
  });
});

describe('isBaseTemplateCreated', () => {
  it('detects when a template with the same name already exists', () => {
    const templates = [createTemplate({ name: 'order_shipped' })];

    expect(isBaseTemplateCreated(templates, 'order_shipped')).toBe(true);
    expect(isBaseTemplateCreated(templates, 'order_confirmed')).toBe(false);
  });
});

// ── Component behaviour ──────────────────────────────────────

describe('WhatsAppTemplateManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the template list with names, status badges and metadata', async () => {
    stubFetch({
      'GET /api/seller/whatsapp/templates': {
        body: {
          templates: [
            createTemplate({ id: 't1', name: 'order_confirmed', category: 'utility', metaStatus: 'approved' }),
            createTemplate({ id: 't2', name: 'payment_reminder', category: 'marketing', metaStatus: 'rejected' }),
            createTemplate({ id: 't3', name: 'delivery_update', category: 'authentication', metaStatus: 'pending' }),
          ],
        },
      },
    });

    renderManager();

    expect(await screen.findByText('order_confirmed')).toBeInTheDocument();
    expect(screen.getByText('payment_reminder')).toBeInTheDocument();
    expect(screen.getByText('delivery_update')).toBeInTheDocument();
    expect(screen.getByText('Aprobado')).toBeInTheDocument();
    expect(screen.getByText('Rechazado')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    // One chip per distinct category → no duplicate matches.
    expect(screen.getByText('Utilidad')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Autenticación')).toBeInTheDocument();
    // Every template item shows its creation date.
    expect(screen.getAllByText('18/09/2026')).toHaveLength(3);
  });

  it('shows the empty message when the channel has no templates', async () => {
    stubFetch({ 'GET /api/seller/whatsapp/templates': { body: { templates: [] } } });

    renderManager();

    expect(await screen.findByText('Aún no hay plantillas creadas.')).toBeInTheDocument();
  });

  it('surfaces the backend error reported by the API when loading templates fails', async () => {
    stubFetch({
      'GET /api/seller/whatsapp/templates': {
        status: 500,
        body: { error: 'Canal no encontrado' },
      },
    });

    renderManager();

    expect(await screen.findByRole('alert')).toHaveTextContent('Canal no encontrado');
  });

  it('shows the generic Spanish message when loading fails without a backend error', async () => {
    stubFetch({
      'GET /api/seller/whatsapp/templates': {
        status: 500,
        body: {},
      },
    });

    renderManager();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar los templates');
  });

  it('shows the generic Spanish message when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network down')));

    renderManager();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar los templates');
  });

  it('disables the base-template button when a template with the same name already exists', async () => {
    stubFetch({
      'GET /api/seller/whatsapp/templates': {
        body: { templates: [createTemplate({ name: 'order_confirmed' })] },
      },
    });

    renderManager();
    await screen.findByText('order_confirmed');

    // The existing base template shows "Creado" and is disabled.
    const createdButton = screen.getByText('Creado').closest('md-filled-tonal-button');
    expect(createdButton).toHaveAttribute('disabled');

    // The other three base templates still offer "Crear".
    const createButtons = screen.getAllByText('Crear');
    expect(createButtons).toHaveLength(3);
    for (const button of createButtons) {
      expect(button.closest('md-filled-tonal-button')).not.toHaveAttribute('disabled');
    }
  });

  it('creates a template from base and refreshes the list', async () => {
    let listCallCount = 0;
    stubFetch({
      'GET /api/seller/whatsapp/templates': () => ({
        body: {
          templates: listCallCount++ === 0 ? [] : [createTemplate({ name: 'order_shipped' })],
        },
      }),
      'POST /api/seller/whatsapp/templates': {
        body: { template: createTemplate({ name: 'order_shipped' }) },
      },
    });

    renderManager();
    await screen.findByText('Aún no hay plantillas creadas.');

    const createButtons = screen.getAllByText('Crear');
    fireEvent.click(createButtons[1]!); // order_shipped

    expect(await screen.findByText('order_shipped')).toBeInTheDocument();
  });

  it('syncs template statuses and shows the summary', async () => {
    let listCallCount = 0;
    stubFetch({
      'GET /api/seller/whatsapp/templates': () => ({
        body: {
          templates: [
            createTemplate({
              name: 'order_confirmed',
              metaStatus: listCallCount++ === 0 ? 'pending' : 'approved',
            }),
          ],
        },
      }),
      'POST /api/seller/whatsapp/templates/sync': {
        body: {
          synced: 1,
          total: 1,
          errors: [],
          results: [{ name: 'order_confirmed', metaStatus: 'approved', metaTemplateId: 'ycloud-1' }],
        },
      },
    });

    renderManager();
    await screen.findByText('Pendiente');

    fireEvent.click(screen.getByText('Sincronizar estado'));

    expect(await screen.findByText('Sincronizados 1 de 1')).toBeInTheDocument();
    // The list was refreshed after syncing → status is now approved.
    expect(await screen.findByText('Aprobado')).toBeInTheDocument();
  });

  it('surfaces sync errors returned by the API', async () => {
    stubFetch({
      'GET /api/seller/whatsapp/templates': {
        body: { templates: [createTemplate({ name: 'order_confirmed' })] },
      },
      'POST /api/seller/whatsapp/templates/sync': {
        status: 500,
        body: { error: 'Canal no conectado' },
      },
    });

    renderManager();
    await screen.findByText('order_confirmed');

    fireEvent.click(screen.getByText('Sincronizar estado'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Canal no conectado');
  });
});