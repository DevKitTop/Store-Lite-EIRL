# ADR 0005: Observabilidad gratuita y presupuesto de JavaScript del storefront

**Status**: Accepted

**Fecha**: 2026-11-07

**Actualizado**: 2026-11-08 — PostHog captura eventos y Web Vitals en producción. Ver
«Restricciones operativas del ingest».

## Contexto

Necesitábamos saber si el sitio está disponible y qué tan rápido carga para una persona
real, con una restricción dura: **solo herramientas gratuitas, sin trials de pago**.

Lo que quedó descartado tras verificarlo:

- **Sentry Performance**: es un trial de 14 días. Se descartó.
- **Vercel Speed Insights**: requiere plan pago.
- **Cloudflare Web Analytics**: no es posible habilitarlo; no hay acceso para otorgar los permisos.
- **PostHog como RUM**: en el momento de esta decisión el SDK inicializaba (cookie
  `ph_phc_..._posthog`) y cargaba extensiones, pero **no emitía ningún POST de captura**, así que
  no producía ni un evento. La causa sí se aisló después; ver «Restricciones operativas del
  ingest».

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
7. **PostHog captura eventos del storefront**, con un contrato operativo explícito: un único
   proyecto y un único token para todos los entornos, más una super property `environment`
   (`production` | `preview` | `development`) que los separa dentro de ese proyecto. Un proyecto
   de PostHog es la unidad de datos, no el entorno: dos proyectos obligan a cambiar de proyecto
   para leer cada entorno y **esconden el tráfico escrito en el otro**.

## Restricciones operativas del ingest

Tres condiciones tienen que cumplirse o los eventos se pierden **en silencio**, sin error visible
en el cliente ni en el servidor. Las tres estuvieron rotas a la vez.

1. **Toda ruta técnica necesita bypass del proxy.** `proxy.ts` resolvía tenancy para cualquier
   ruta sin punto en el pathname, así que `POST /ingest/i/v0/e` (sin extensión) recibía
   `302 /auth?redirect=...` y el evento se descartaba. Los `GET` a `config.js` y a las extensiones
   sí funcionaban porque tienen `.js`, y eso disfrazaba el fallo: el SDK parecía inicializar bien.
   El bypass cubre `/_next`, `/static`, `/ingest` y `/monitoring`, por segmento completo.
2. **`upgrade-insecure-requests` solo se emite sobre https.** Next reporta
   `request.nextUrl.protocol` como `https:` aunque la request llegue por http, así que el valor
   correcto se obtiene de `new URL(request.url).protocol`. Con la directiva sobre http, el
   navegador subía el POST a https y moría con `ERR_SSL_PROTOCOL_ERROR`.
3. **El túnel de Sentry (`tunnelRoute: /monitoring`) sufre exactamente el mismo `302`.** Rompía
   la captura de errores de cliente, que es justo lo que se usa para detectar este tipo de fallo.

Además, el proyecto mantiene **un solo token en todos los entornos**. Hubo un segundo token
(`phc_16vwa...`, proyecto distinto) inlineado en el build de Vercel mientras el `.env` local usaba
otro: todo el tráfico desplegado aterrizaba en un proyecto que nadie miraba.

### Trampa de verificación

`posthog-js` aplica detección de bots dentro del SDK: `capture()` calcula
`!opt_out_useragent_filter && _is_bot()` y **descarta el evento en silencio**. En un navegador
automatizado `_is_bot()` devuelve `true` aun con un User-Agent de Chrome real y
`navigator.webdriver` falseado.

Consecuencia directa: **ninguna verificación de captura hecha con Playwright o headless es
válida**, ni positiva ni negativa. La única evidencia aceptable es un navegador real, y la prueba
más rápida es:

```js
performance
  .getEntriesByType('resource')
  .filter((e) => e.name.includes('/ingest'))
  .map((e) => e.name);
```

Si devuelve `[]`, el SDK no arrancó o la página quedó en caché de un deploy anterior; si aparecen
`POST .../i/v0/e/`, el envío ocurrió y cualquier ausencia posterior ya es del lado de PostHog.

## Consecuencias

**Positivas**

- Hay monitoreo de disponibilidad sin costo.
- La portada del storefront bajó 20 % de JavaScript y el TBT observado cayó de 637 ms a ~300 ms.
- Hay Core Web Vitals de usuarios reales (LCP, INP, CLS) sin costo: PostHog captura `$pageview`,
  `$autocapture` y `$web_vitals` en producción, verificado con tráfico real.
- Quedan registrados los experimentos que **no** funcionan, con números, para no repetirlos.

**Negativas**

- Uptime Kuma solo monitorea mientras la PC del mantenedor está encendida; no reemplaza un
  servicio externo de uptime.
- El ingest depende de tres invariantes frágiles (bypass del proxy, CSP según protocolo, túnel de
  Sentry). Romper una sola pierde eventos sin error visible, y el fallo solo se detecta mirando
  el tráfico real.
- Sentry Replay cuesta ~215 ms de TBT que se pagan a cambio de poder reproducir sesiones.

**Neutras**

- El LCP simulado no es una señal de usuario en este proyecto: sirve para comparar versiones
  entre sí, nunca como métrica absoluta.
