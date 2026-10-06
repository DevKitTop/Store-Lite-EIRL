// ============================================================
// BASE TEMPLATES (Pre-defined, Peruvian Spanish)
// Shared between server actions and API routes
// ============================================================

export interface BaseTemplateComponent {
  type: 'header' | 'body' | 'button' | 'footer';
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT';
  text?: string;
  sub_type?: 'url' | 'quick_reply' | 'phone_number';
  url?: string;
}

export interface BaseTemplate {
  name: string;
  category: 'marketing' | 'utility' | 'authentication';
  language: string;
  body: string;
  components: BaseTemplateComponent[];
}

export const BASE_TEMPLATES: readonly BaseTemplate[] = [
  {
    name: 'order_confirmed',
    category: 'utility',
    language: 'es',
    body: 'Hola {{1}}! Tu pedido #{{2}} ha sido confirmado por {{3}}. Monto: S/ {{4}}. Estado: Confirmado.',
    components: [
      { type: 'header', format: 'TEXT' },
      {
        type: 'body',
        text: 'Hola {{1}}! Tu pedido #{{2}} ha sido confirmado por {{3}}. Monto: S/ {{4}}. Estado: Confirmado.',
      },
      { type: 'button', sub_type: 'url', text: 'Ver pedido', url: 'https://storelite.app/orders/{{5}}' },
    ],
  },
  {
    name: 'order_shipped',
    category: 'utility',
    language: 'es',
    body: '¡Tu pedido #{{1}} ya está en camino! 📦 Transportista: {{2}}. Guía: {{3}}. Entrega estimada: {{4}}.',
    components: [
      {
        type: 'body',
        text: '¡Tu pedido #{{1}} ya está en camino! 📦 Transportista: {{2}}. Guía: {{3}}. Entrega estimada: {{4}}.',
      },
      { type: 'button', sub_type: 'url', text: 'Rastrear', url: 'https://storelite.app/track/{{5}}' },
    ],
  },
  {
    name: 'payment_reminder',
    category: 'utility',
    language: 'es',
    body: 'Hola {{1}}, recordatorio de pago para tu pedido #{{2}}. Monto: S/ {{3}}. Vence: {{4}}. Paga aquí: {{5}}',
    components: [
      {
        type: 'body',
        text: 'Hola {{1}}, recordatorio de pago para tu pedido #{{2}}. Monto: S/ {{3}}. Vence: {{4}}. Paga aquí: {{5}}',
      },
      { type: 'button', sub_type: 'url', text: 'Pagar ahora', url: '{{5}}' },
    ],
  },
  {
    name: 'delivery_update',
    category: 'utility',
    language: 'es',
    body: 'Actualización de entrega para pedido #{{1}}: {{2}}. {{3}}',
    components: [
      { type: 'body', text: 'Actualización de entrega para pedido #{{1}}: {{2}}. {{3}}' },
    ],
  },
] as const;

export function getBaseTemplate(name: string): BaseTemplate | undefined {
  return BASE_TEMPLATES.find((t) => t.name === name);
}

export function applyBusinessName(template: BaseTemplate, businessName: string): BaseTemplate {
  return {
    ...template,
    body: template.body.replace('{{3}}', businessName),
    components: template.components.map((comp) => {
      if (comp.type === 'body' && comp.text) {
        return { ...comp, text: comp.text.replace('{{3}}', businessName) };
      }
      return comp;
    }),
  };
}