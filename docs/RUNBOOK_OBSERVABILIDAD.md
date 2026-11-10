# Runbook de observabilidad

Cómo operar Store Lite con el stack de observabilidad gratuito que corre hoy en producción.

**Alcance:** errores y logs (Sentry), comportamiento de producto (PostHog), despliegues (Vercel).

---

## 1. Dónde mirar

| Panel                    | Responde                               | Se usa cuando                                               |
| ------------------------ | -------------------------------------- | ----------------------------------------------------------- |
| **Sentry → Issues**      | Qué se rompió, a quién, en qué release | Un usuario reporta un error, o te llega una alerta          |
| **Sentry → Logs**        | Qué pasó dentro de un flujo puntual    | Necesitás reconstruir una secuencia, no solo el error final |
| **Sentry → Releases**    | Qué cambió entre deploys               | El error apareció hoy y ayer no estaba                      |
| **PostHog → Funnels**    | Dónde se cae la gente                  | Decidir qué construir después                               |
| **PostHog → Web Vitals** | Si el storefront es rápido             | Después de tocar el frontend                                |
| **Vercel → Deployments** | Si el deploy salió bien                | Cualquier cambio en producción                              |

---

## 2. Rutina

### Diario (2 minutos)

1. Sentry → Issues → ordenar por **frecuencia**.
2. Si un error nuevo se repite y trae un `business_id` concreto, es un negocio trabado, no ruido. Ese se atiende el mismo día.
3. Si aparece un error en un release viejo y no en el nuevo, ya está resuelto: archivá.

### Semanal (10 minutos)

1. PostHog → embudo:

   ```
   user_signed_up → business_created → product_created → checkout_started → payment_completed
   ```

   El escalón con mayor caída es el próximo trabajo de producto.

2. Sentry → Releases: compará la tasa de error del último release contra el anterior.
3. PostHog → Web Vitals: si LCP sube de 2.5 s o INP de 200 ms, se revisa antes de sumar features.

---

## 3. Alertas a configurar

Todas en **Sentry → Alerts → Create Alert → Issues**, canal email.

| Alerta                  | Condición                                           | Por qué                                               |
| ----------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Error rate alto         | `level:error`, más de 20 eventos en 5 minutos       | Detecta una regresión del deploy sin esperar reportes |
| Fallos de pago          | `level:error` con `payment` en el mensaje o la ruta | Un pago que falla es plata que no entra               |
| API crítica             | `level:error` en rutas `/api/*`                     | Webhooks y crons caídos no generan reporte de usuario |
| Fallos de base de datos | mensaje con `ECONNREFUSED`, `timeout` o `deadlock`  | Se ve antes de que se caiga todo                      |

Cada alerta debe llevar `business_id` en el contexto para poder responder "¿a quién le está pasando?".

---

## 4. Eventos disponibles

Todas las propiedades incluyen `environment`, y cuando aplica `business_id`, `plan` y `user_id`.

| Área             | Eventos                                                                                                                                            |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Autenticación    | `user_signed_up`, `user_registered`, `user_signed_in`, `user_signed_out`                                                                           |
| Negocio          | `business_created`, `business_slug_updated`, `storefront_customized`, `payment_gateway_configured`                                                 |
| Catálogo         | `product_created`, `product_viewed`, `export_downloaded`                                                                                           |
| Carrito y compra | `cart_item_added`, `checkout_started`, `checkout_shipping_completed`, `payment_initiated`, `order_created`, `order_completed`, `payment_completed` |
| Verificación     | `otp_requested`, `otp_verified`, `otp_verification_failed`                                                                                         |
| WhatsApp         | `whatsapp_message_sent`, `whatsapp_template_message_sent`                                                                                          |
| Soporte          | `chat_session_started`, `complaint_submitted`, `platform_complaint_submitted`                                                                      |

**Regla:** para agregar un evento se declara en `src/lib/analytics/taxonomy.ts` y se emite con la constante. Un test falla si alguien escribe el nombre como string suelto. Nunca renombres uno existente: las insights guardadas consultan ese string.

---

## 5. Invariantes que no se tocan

| Invariante                                                                    | Qué rompe si se cae                                                                                             | Dónde                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Bypass del proxy para `/ingest`, `/monitoring`, `/_next`, `/static`           | Los eventos de PostHog y Sentry desaparecen **en silencio**: el middleware los redirige a `/auth`               | `src/lib/middleware/proxyBypass.ts`          |
| `upgrade-insecure-requests` solo cuando el origen ya es https                 | En local rompe el ingreso de datos                                                                              | `src/lib/middleware/securityHeaders.ts`      |
| Túnel de Sentry en `/monitoring`                                              | Los bloqueadores de anuncios descartan los reportes                                                             | `next.config.ts`                             |
| `stockFulfillment.ts` usa `console.error`, nunca el logger                    | El `scrubPII` matchea secuencias de 6-11 dígitos y **destruye UUIDs**: los logs de fulfillment quedan ilegibles | `src/core/payments/stockFulfillment.ts`      |
| Un solo proyecto y un solo token de PostHog, con super property `environment` | Dos proyectos esconden el tráfico escrito en el otro                                                            | `src/shared/analytics/posthogInitOptions.ts` |

Los tres primeros están cubiertos por tests. **No borrar esos tests.**

---

## 6. Verificar que el monitoreo funciona

Después de un cambio en el middleware, en `next.config.ts` o en variables de entorno:

### Errores (Sentry)

1. Provocar un error en producción y buscarlo en Sentry → Issues.
2. Debe traer `release` (SHA del commit), `environment` y, si hay sesión, `business_id` y `plan`.
3. El stack trace debe ser **legible**. Si aparece minificado, no subieron los source maps: revisá `SENTRY_AUTH_TOKEN` en Vercel y el build log.

### Eventos (PostHog)

1. Navegar el storefront y completar una acción con evento propio.
2. En DevTools → Network, filtrar por `/ingest`. Debe aparecer `POST /ingest/i/v0/e/` con 200.
3. Si aparece 302 hacia `/auth`, se rompió el bypass del proxy.

> **Trampa:** `posthog-js` detecta bots y descarta eventos en silencio. Una prueba con Playwright o headless **no vale**, ni en positivo ni en negativo. La única verificación válida es un navegador real.

---

## 7. Diagnóstico rápido

| Síntoma                                   | Causa más probable                                                | Arreglo                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| No llega ningún evento nuevo a PostHog    | Proxy devolviendo 302, o token de otro proyecto                   | Revisar `/ingest` en Network y comparar el token del bundle con el del panel |
| Los eventos llegan pero sin `environment` | Build sin `NEXT_PUBLIC_VERCEL_ENV`                                | Redeploy: las variables `NEXT_PUBLIC_*` se inlinean en build                 |
| Errores sin `release`                     | `SENTRY_AUTH_TOKEN` ausente en Vercel, o build anterior al cambio | Cargar la variable y redeploy                                                |
| Stack traces minificados                  | Source maps no subidos                                            | Ver "Errores" arriba                                                         |
| Un error muestra un UUID mutilado         | Se migró `stockFulfillment.ts` al logger                          | Revertir a `console.error` en ese archivo                                    |

---

## 8. Límites del plan gratuito

| Servicio | Límite                                                | Palanca cuando se acerca                                    |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Sentry   | Errores y replays mensuales acotados; retención corta | Bajar `tracesSampleRate` antes que apagar el logging        |
| PostHog  | 1M eventos/mes                                        | Revisar eventos de alta frecuencia antes de tocar el embudo |

El logging de componentes de UI quedó deliberadamente en `console`: mandarlo a Sentry Logs gastaría la cuota sin dar diagnóstico de servidor.

---

## 9. Decisiones registradas

- **Un proyecto de PostHog para todos los entornos** y super property `environment`. Ver ADR 0005.
- **Feature flags:** no se implementaron. PostHog los soporta de forma nativa cuando haga falta; el proceso quedó documentado en el historial de la feature.
- **Sentry Performance:** descartado, era trial de 14 días. Se usan Web Vitals reales vía PostHog.

---

## 10. Disponibilidad (uptime)

**Decisión:** UptimeRobot (plan free) para disponibilidad 24/7. Uptime Kuma queda en
local, sólo como status page presentable cuando haga falta mostrarla.

**Por qué no Kuma en cloud:** los PaaS gratuitos (Render, Koyeb) duermen el servicio por
inactividad, lo que anula un monitor. Fly.io ya no tiene free tier. La única alternativa
realmente gratis y encendida es una VM (Oracle/GCP Always Free), que exige mantener un
servidor para tres pings: no se paga solo.

**Datos de Kuma:** viven en `~/Documents/store-lite-kuma/data`. Antes estaban en
`%TEMP%`, que Windows limpia: los monitores podían desaparecer sin aviso.

### Monitores a crear

Todos con intervalo de 5 minutos y alerta por email.

| Nombre         | URL                                                         | Tipo              | Keyword      |
| -------------- | ----------------------------------------------------------- | ----------------- | ------------ |
| Landing        | `https://store-lite-eirl.vercel.app/`                       | HTTP(s) + Keyword | `Store Lite` |
| Ingest PostHog | `https://store-lite-eirl.vercel.app/ingest/static/array.js` | HTTP(s) + Keyword | `posthog`    |
| Auth           | `https://store-lite-eirl.vercel.app/auth`                   | HTTP(s)           | —            |

El del ingest es el importante: si el bypass del proxy se rompe, esa URL responde la
pantalla de login (200) en lugar del JavaScript. Sin el chequeo por keyword el monitor
diría "up" mientras todos los eventos se pierden.

### Lo que NO se puede monitorear ahí

El túnel de Sentry (`/monitoring`) **no** sirve como monitor HTTP en UptimeRobot: el
rewrite exige los parámetros `o`, `p` y `r`, y sólo atiende envelopes por POST. Un GET
con esos parámetros devuelve 404 por diseño, así que el monitor lo marcaría caído.

Verificación manual del túnel (esperado: **401** con `bad envelope authentication header`):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Content-Type: application/x-sentry-envelope" \
  "https://store-lite-eirl.vercel.app/monitoring?o=4511785250324480&p=4511785277063168&r=us"
```

Un **200, 302 o 404** ahí significan que el túnel dejó de reenviar, y con él se pierden
los errores de los usuarios que tienen bloqueadores.
