'use client';

import Link from 'next/link';
import { useState } from 'react';
import styles from './PricingSection.module.css';

type BillingPeriod = 'monthly' | 'annual';

interface Plan {
  name: string;
  featured: boolean;
  tag?: string;
  monthly: number;
  annual: number;
  description: string;
  features: readonly string[];
  includesBase?: boolean;
  cta: string;
  ctaVariant: 'primary' | 'outline';
}

const PLANS: Plan[] = [
  {
    name: 'Lite Pago',
    featured: true,
    tag: 'Más elegido',
    monthly: 39,
    annual: 32.5,
    description: 'Para negocios que ya venden y quieren llevar su marca al siguiente nivel.',
    features: [
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
    ],
    cta: 'Escalar mi negocio',
    ctaVariant: 'primary',
  },
  {
    name: 'Lite Plus',
    featured: false,
    monthly: 79,
    annual: 65.83,
    description: 'Para marcas que necesitan el máximo rendimiento y todas las herramientas.',
    includesBase: true,
    features: [
      'Hasta 600 productos publicados',
      'Hasta 3 imágenes por producto',
      'Equipo de hasta 4 usuarios adicionales',
      'Dashboard avanzado con métricas en tiempo real',
      'Soporte y feedback con prioridad alta',
    ],
    cta: 'Obtener máxima potencia',
    ctaVariant: 'outline',
  },
];

function periodLabel(period: BillingPeriod): string {
  return period === 'annual' ? '/mes facturado anual' : '/mes';
}

export default function PricingSection() {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');

  return (
    <section className={styles.section} id="pricing">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <span className="material-symbols-rounded" aria-hidden="true">
              flag
            </span>
            Encuentra el plan que necesitas
          </h2>
          <p>Precios claros. Sin letras chiquitas. Empieza gratis y escala cuando quieras.</p>
        </div>

        <div className={styles.pricingToggle} role="group" aria-label="Período de facturación">
          <button
            type="button"
            className={`${styles.toggleButton} ${
              period === 'monthly' ? styles.toggleActive : styles.toggleInactive
            }`}
            onClick={() => setPeriod('monthly')}
            aria-pressed={period === 'monthly'}
          >
            Mensual
          </button>
          <button
            type="button"
            className={`${styles.toggleButton} ${
              period === 'annual' ? styles.toggleActive : styles.toggleInactive
            }`}
            onClick={() => setPeriod('annual')}
            aria-pressed={period === 'annual'}
          >
            Anual
          </button>
        </div>

        <div className={styles.plans}>
          {PLANS.map((plan) => (
            <div
              className={`${styles.plan} ${plan.featured ? styles.planFeatured : ''}`}
              key={plan.name}
            >
              {plan.tag && <span className={styles.planTag}>{plan.tag}</span>}
              <h3>{plan.name}</h3>
              <p className={styles.price}>
                {`S/ ${period === 'monthly' ? plan.monthly : plan.annual}`}
                <span>{periodLabel(period)}</span>
              </p>
              <p className={styles.desc}>{plan.description}</p>
              <ul className={styles.planFeatures}>
                {plan.includesBase && (
                  <li className={styles.featureBase}>
                    <span className="material-symbols-rounded">all_inclusive</span>
                    Todo lo que incluye Lite Pago
                  </li>
                )}
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <span className="material-symbols-rounded">check</span>
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                className={`${styles.btn} ${
                  plan.ctaVariant === 'primary' ? styles.btnPrimary : styles.btnOutline
                }`}
                href="/auth"
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        <p className={styles.plansNote}>
          Todos los planes incluyen dominio gratis · soporte básico · sin permanencia
        </p>
      </div>
    </section>
  );
}
