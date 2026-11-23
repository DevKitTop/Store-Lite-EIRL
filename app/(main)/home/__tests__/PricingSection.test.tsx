import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublicLandingPromotion } from '@/features/promotions/publicPromotionResolver';

import PricingSection from '../PricingSection';

const NAVIDAD_PROMOTION: PublicLandingPromotion = {
  code: 'navidad-2026',
  name: 'Navidad 2026 — 20% Lite Pago',
  percentOff: 20,
  originalMonthlyPriceCents: 3900,
  finalMonthlyPriceCents: 3120,
  originalAnnualMonthlyPriceCents: 3250,
  finalAnnualMonthlyPriceCents: 2600,
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ promotion: null }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PricingSection — pricing plans with toggle', () => {
  it('renders the section with id="pricing" as the scroll-spy target', () => {
    const { container } = render(<PricingSection />);
    const section = container.querySelector('section[id="pricing"]');
    expect(section).not.toBeNull();
  });

  it('renders the headline and intro paragraph', () => {
    render(<PricingSection />);

    // The heading contains an icon span (rendered as text), match by partial text
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toContain('Encuentra el plan que');
    expect(
      screen.getByText(/Precios claros\. Sin letras chiquitas\. Empieza gratis/),
    ).toBeInTheDocument();
  });

  it('renders the billing toggle with Mensual and Anual options', () => {
    render(<PricingSection />);

    const mensual = screen.getByRole('button', { name: /mensual/i });
    const anual = screen.getByRole('button', { name: /anual/i });
    expect(mensual).toBeInTheDocument();
    expect(anual).toBeInTheDocument();
  });

  it('defaults to Mensual as the active toggle option', () => {
    render(<PricingSection />);

    const mensual = screen.getByRole('button', { name: /mensual/i });
    const anual = screen.getByRole('button', { name: /anual/i });
    expect(mensual).toHaveAttribute('aria-pressed', 'true');
    expect(anual).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches active toggle when Anual is clicked', async () => {
    const user = userEvent.setup();
    render(<PricingSection />);

    const anual = screen.getByRole('button', { name: /anual/i });
    await user.click(anual);

    expect(anual).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /mensual/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('renders both plans with name, price, and description', () => {
    render(<PricingSection />);

    expect(screen.getByRole('heading', { level: 3, name: 'Lite Pago' })).toBeInTheDocument();
    expect(screen.getByText('S/ 39')).toBeInTheDocument();
    expect(
      screen.getByText(/Para negocios que ya venden y quieren llevar su marca/),
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { level: 3, name: 'Lite Plus' })).toBeInTheDocument();
    expect(screen.getByText('S/ 79')).toBeInTheDocument();
    expect(screen.getByText(/Para marcas que necesitan el máximo rendimiento/)).toBeInTheDocument();
  });

  it('renders the "Más elegido" tag on the featured plan', () => {
    render(<PricingSection />);

    expect(screen.getByText('Más elegido')).toBeInTheDocument();
  });

  it('renders plan features without duplicating across plans', () => {
    render(<PricingSection />);

    // Length guards prove the forEach loops below actually run against real data
    const litePagoFeatures = [
      'Pagos con tarjetas, Yape y Plin vía Culqi',
      'Tu propia tienda en Store Lite (subdominio)',
      'Hasta 300 productos publicados',
      'Importa tu catálogo desde Excel o SQL',
      'Personaliza colores, fuentes y diseño',
      'Chat en tiempo real con tus clientes',
      'Dashboard con métricas de ventas',
      'SEO avanzado: meta tags, JSON-LD y sitemap',
      'Asistente de IA para generar contenido y responder',
      'Equipo de trabajo con 2 usuarios adicionales',
    ];
    const litePlusExtras = [
      'Hasta 600 productos publicados',
      'Hasta 3 imágenes por producto',
      'Equipo de hasta 4 usuarios adicionales',
      'Dashboard avanzado con métricas en tiempo real',
      'Soporte y feedback con prioridad alta',
    ];
    expect(litePagoFeatures).toHaveLength(10);
    expect(litePlusExtras).toHaveLength(5);

    litePagoFeatures.forEach((f) => expect(screen.getByText(f)).toBeInTheDocument());
    litePlusExtras.forEach((f) => expect(screen.getByText(f)).toBeInTheDocument());

    // Lite Plus renders a single base-include line, not repeated Lite Pago features
    expect(screen.getByText('Todo lo que incluye Lite Pago')).toBeInTheDocument();

    // No feature is duplicated across plans
    expect(screen.getAllByText('Hasta 300 productos publicados')).toHaveLength(1);
    expect(screen.getAllByText('SEO avanzado: meta tags, JSON-LD y sitemap')).toHaveLength(1);

    // 10 check icons (Lite Pago) + 5 check icons (Lite Plus extras) + 1 all_inclusive (base line)
    expect(screen.getAllByText('check')).toHaveLength(15);
    expect(screen.getAllByText('all_inclusive')).toHaveLength(1);
  });

  it('renders the CTAs for each plan pointing to the auth flow', () => {
    render(<PricingSection />);

    expect(screen.getByRole('link', { name: /Escalar mi negocio/i })).toHaveAttribute(
      'href',
      '/auth',
    );
    expect(screen.getByRole('link', { name: /Obtener máxima potencia/i })).toHaveAttribute(
      'href',
      '/auth',
    );
  });

  it('shows the discounted annual price and annual period label when Anual is active', async () => {
    const user = userEvent.setup();
    render(<PricingSection />);

    const anual = screen.getByRole('button', { name: /anual/i });
    await user.click(anual);

    // Lite Pago: monthly S/ 39 -> annual S/ 32.5 (~20% off, billed yearly)
    expect(screen.getByText('S/ 32.5')).toBeInTheDocument();
    expect(screen.getAllByText('/mes facturado anual')).toHaveLength(2);
    expect(screen.queryByText('S/ 39')).not.toBeInTheDocument();

    // Lite Plus: monthly S/ 79 -> annual S/ 65.83
    expect(screen.getByText('S/ 65.83')).toBeInTheDocument();
    expect(screen.queryByText('S/ 79')).not.toBeInTheDocument();
  });

  it('restores monthly prices and the /mes period label when switching back to Mensual', async () => {
    const user = userEvent.setup();
    render(<PricingSection />);

    await user.click(screen.getByRole('button', { name: /anual/i }));
    await user.click(screen.getByRole('button', { name: /mensual/i }));

    expect(screen.getByText('S/ 39')).toBeInTheDocument();
    expect(screen.getByText('S/ 79')).toBeInTheDocument();
    expect(screen.getAllByText('/mes')).toHaveLength(2);
    expect(screen.queryByText('/mes facturado anual')).not.toBeInTheDocument();
  });

  it('renders the plans note with benefits', () => {
    render(<PricingSection />);

    expect(screen.getByText(/Todos los planes incluyen dominio gratis/)).toBeInTheDocument();
  });

  it('does not show a promotion banner by default', () => {
    render(<PricingSection />);

    expect(screen.queryByText(/20% OFF en Lite Pago/)).not.toBeInTheDocument();
    expect(screen.queryByText('S/ 31.2')).not.toBeInTheDocument();
  });

  it('shows the active promotion banner and discounted Lite Pago prices', async () => {
    const user = userEvent.setup();
    render(<PricingSection promotion={NAVIDAD_PROMOTION} />);

    expect(screen.getByText(/20% OFF en Lite Pago/)).toBeInTheDocument();
    expect(screen.getByText('S/ 31.2')).toBeInTheDocument();
    expect(screen.getByText('S/ 39')).toBeInTheDocument();
    expect(screen.getByText('S/ 79')).toBeInTheDocument();
    expect(screen.queryByText('S/ 63.2')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /anual/i }));

    expect(screen.getByText('S/ 26')).toBeInTheDocument();
    expect(screen.getByText('S/ 32.5')).toBeInTheDocument();
  });

  it('applies a promotion returned by the public endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ promotion: NAVIDAD_PROMOTION }),
      }),
    );

    render(<PricingSection />);

    expect(await screen.findByText(/20% OFF en Lite Pago/)).toBeInTheDocument();
    expect(screen.getByText('S/ 31.2')).toBeInTheDocument();
  });
});
