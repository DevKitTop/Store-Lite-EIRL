# ADR 0005: Observabilidad gratuita y presupuesto de JavaScript del storefront

**Status**: Accepted

**Fecha**: 2026-11-07

## Contexto

Necesitábamos saber si el sitio está disponible y qué tan rápido carga para una persona
real, con una restricción dura: **solo herramientas gratuitas, sin trials de pago**.

Lo que quedó descartado tras verificarlo:

- **Sentry Performance**: es un trial de 14 días. Se descartó.
- **Vercel Speed Insights**: requiere plan pago.
- **Cloudflare Web Analytics**: no es posible habilitarlo; no hay acceso para otorgar los permisos.
- **PostHog como RUM**: el SDK inicializa (cookie `ph_phc_..._posthog`), carga extensiones, pero
  **no emite ningún POST de captura**. Hoy no produce ni un evento, así que no sirve como fuente
  de Core Web Vitals de usuarios reales. La causa no está aislada y `defaults` no la controla.

Medición disponible en ese escenario: Lighthouse 12 en modo mobile sobre un build de producción
local. Su LCP **simulado** (7–9 s) no representa al usuario: en el mismo build el LCP **observado**
es de 544–656 ms. La simulación castiga el volumen de JavaScript con CPU 4× más lenta.

## Decisión

1. **Disponibilidad**: Uptime Kuma autogestionado con tres monitores HTTP contra producción
   (`/`, `/store-lite-store-cfno`, `/auth`). Corre en la PC del mantenedor.
2. **Sentry Replay se mantiene**. Costo medido y aceptado: +39 KB de JS y ~215 ms de TBT.
   No existe forma limpia de diferirlo: `@sentry/nextjs` 10.58 no exporta `lazyLoadIntegration`.
3. **PostHog sin grabación de sesión ni encuestas**: `disable_session_recording: true` y
   `disable_surveys: true`. Quita `recorder.js` (69 KB) y `surveys.js` (48 KB).
4. **Presupuesto de JS del storefront**: todo lo que solo se usa por interacción se carga bajo
   demanda. Aplicado a las herramientas de staff (`StorefrontEditor` + `PatternBrowser`) y al
   flujo de checkout. Resultado: 818 KB → 655 KB de JavaScript de cliente (-20 %).
5. **No usar `experimental.inlineCss`**. En Next 16.2.9 con Turbopack duplica el CSS: el HTML del
   storefront pasó de 112 KB a 937 KB y tanto FCP como LCP empeoraron. El ahorro estimado por
   Lighthouse en recursos bloqueantes (2 424 ms) no es un ahorro real.
6. **Ninguna medición de performance vale sin A/B**. Toda afirmación de mejora se contrasta
   midiendo antes y después con la misma receta.

## Consecuencias

**Positivas**

- Hay monitoreo de disponibilidad sin costo.
- La portada del storefront bajó 20 % de JavaScript y el TBT observado cayó de 637 ms a ~300 ms.
- Quedan registrados los experimentos que **no** funcionan, con números, para no repetirlos.

**Negativas**

- Uptime Kuma solo monitorea mientras la PC del mantenedor está encendida; no reemplaza un
  servicio externo de uptime.
- No hay Core Web Vitals de usuarios reales hasta que PostHog capture eventos o se construya un
  endpoint propio de `web_vitals`.
- Sentry Replay cuesta ~215 ms de TBT que se pagan a cambio de poder reproducir sesiones.

**Neutras**

- El LCP simulado no es una señal de usuario en este proyecto: sirve para comparar versiones
  entre sí, nunca como métrica absoluta.
