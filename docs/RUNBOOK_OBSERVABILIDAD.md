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

---

## 11. Tests E2E (TestSprite)

Un test de humo del storefront corre contra producción. No reemplaza a Playwright: lo
complementa donde hace falta una ejecución en navegador real sin escribir el test a mano.

- **Proyecto:** `storelite` (`5ac72cbd-321f-4fe9-bac4-cc07af026ac2`), entorno `default`
  apuntando a `https://storelite.app`.
- **Test:** "Storefront adds a product to the cart" (`e06d5b54-1258-436b-a5e4-bee51853a9d6`).

### Alcance deliberado

El test abre `https://store-lite-store-cfno.storelite.app/product/plan-99-pasarela`, verifica
nombre y precio, pulsa **"Al carrito"** y comprueba que el carrito queda con el ítem.

**Se detiene ahí a propósito.** El checkout exige OTP por WhatsApp y termina en un cobro
real: un test E2E sobre producción no debe disparar mensajes ni pagos. Verificar el
formulario de checkout requiere un entorno con números de prueba, no el sitio real.

### Cómo correrlo

```bash
npx -y @testsprite/testsprite-cli test rerun e06d5b54-1258-436b-a5e4-bee51853a9d6 --wait
npx -y @testsprite/testsprite-cli test failure get <testId> --out ./.testsprite/failure
```

La API key vive en `~/.testsprite/credentials`, fuera del repositorio. En CI se pasa por
`TESTSPRITE_API_KEY`; nunca como argumento ni en un archivo versionado.

### Costo y límites del plan Free

| Dato                    | Valor medido                       |
| ----------------------- | ---------------------------------- |
| Créditos por corrida    | ~0.5 (146.7 → 146.2)               |
| Créditos por mes        | 150 por asiento                    |
| Tamaño del proyecto     | 1 entorno, 1 lista de tests        |
| Ejecuciones programadas | no incluidas (empiezan en Starter) |

La única automatización disponible en Free es el auto-test en PR del portal, sobre un
repositorio. Con ~290 corridas mensuales disponibles, el costo no es el límite.

### Límite conocido

Con _V3 routing_, un rerun de frontend reproduce **la corrida a la que se apuntó**, no
necesariamente el código guardado más reciente. Un verde en un rerun confirma que el
comportamiento sigue igual, no que esté probando el último cambio de código.

Además, los controles son custom elements de Material Web: el botón se localiza por su
texto visible ("Al carrito"), no por selector CSS. Si se renombra esa etiqueta, el test
falla por un motivo que no es una regresión.

## 12. Peso de JavaScript de first-load

Next 16 dejó de imprimir tamaños por ruta en el build y sus chunks son archivos planos con
hash, así que ni el log ni un glob de rutas pueden decir cuánto JavaScript entrega una ruta.
`analyze:bundle` era un alias de `next build` y no medía nada.

```bash
pnpm audit:js --url https://storelite.app
pnpm audit:js --url https://store-lite-store-cfno.storelite.app --budget-kb 600 --json
```

El script pide la página, resuelve cada `<script src>` y cada `<link rel="modulepreload">`
del mismo origen, descarga cada archivo y reporta bytes crudos y gzip. Con `--budget-kb`
devuelve exit 1 cuando el total gzip supera el presupuesto.

Medición del 2026-11-10 sobre producción:

| objetivo                  | scripts | crudo     | gzip     |
| ------------------------- | ------- | --------- | -------- |
| `storelite.app` (landing) | 18      | 1455.5 KB | 448.5 KB |
| tienda tenant (`/`)       | 26      | 1832.5 KB | 554.8 KB |

**Alcance**: sólo lo que el HTML inicial referencia. PostHog se carga en runtime y queda
fuera, así que el número NO es comparable con los 655 KB del ADR 0005 (medidos con
Lighthouse mobile, que incluye todo). Sirve para detectar regresiones entre commits de la
misma ruta, no como comparación absoluta contra el presupuesto histórico.

No está cableado en CI a propósito: un gate de bytes que nadie calibró falla por ruido. Se
corre a mano antes de una release que toque el storefront.

### Lighthouse manual

`pnpm performance:audit` se eliminó: apuntaba a un binario que no está instalado,
escribía en un `reports/` que no existe y no fijaba versión. Fallaba siempre y
prometía una medición que nunca ocurrió.

Cuando haga falta una auditoría real de performance:

1. Build de producción local y servidor levantado. Con `next dev` los números no
   representan nada.
2. Un Chrome real disponible: Lighthouse lanza su propia instancia y necesita el
   binario (las de Playwright sirven si se exporta `CHROME_PATH`).
3. Crear `reports/` antes y correr:

```bash
npx --yes lighthouse@12 http://localhost:3000 \
  --output=json --output-path=./reports/lighthouse.json --chrome-flags="--headless"
```

Es manual a propósito: los scores varían ±10 entre corridas y un gate de CI con ese
ruido se termina desactivando.

## 13. Las dos tareas manuales, paso a paso

### 13.1 Crear los tres monitores en UptimeRobot

Por qué a mano: en cuentas Free nuevas la API responde `access_denied` al crear monitores
(`newMonitor`), así que una API key no ahorra el trabajo. El plan Free alcanza de sobra: 50
monitores y chequeo cada 5 minutos.

1. Entrar a `uptimerobot.com`, registrarse con el mail del equipo y confirmar ese mail.
2. Dashboard → **Add New Monitor**.
3. Por cada fila de la tabla de §10:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: el nombre de la tabla
   - **URL**: la de la tabla
   - **Monitoring Interval**: `5 minutes`
   - En Landing e Ingest: tildar **Keyword**, pegar la keyword y elegir que debe existir
   - **Alert Contacts**: el mail. Sin esto el monitor cambia de color pero nadie se entera
4. **Create Monitor** y repetir para las otras dos filas.

Cómo saber que quedó bien: los tres quedan UP. Si Ingest da DOWN mientras Landing sigue UP,
el bypass del proxy (`src/lib/middleware/proxyBypass.ts`) dejó de aplicar y los eventos se
están perdiendo.

### 13.2 Por qué el monitor de Ingest lleva keyword

`/ingest/static/array.js` no es una ruta de la aplicación: es un rewrite hacia el CDN de
PostHog. Si el middleware deja de excluirla, la petición cae en el matcher del tenant, que
responde la pantalla de login con **200**. Un monitor HTTP simple vería 200 y diría "todo
bien" mientras el 100% de los eventos se descarta.

La keyword `posthog` distingue el JavaScript real del HTML de login. Es el único de los tres
que detecta una falla silenciosa; los otros dos sólo detectan caídas visibles.

### 13.3 Verificar PostHog desde un navegador real

`posthog-js` tiene detección de bots y descarta en silencio los eventos de navegadores
automatizados (`_is_bot()`). Por eso ningún test headless sirve acá: ni un verde ni un rojo
prueban algo. Se hace a mano, una vez, y de nuevo después de cada deploy que toque analytics.

1. Abrir `https://storelite.app` en una ventana normal, sin bloqueadores.
2. Entrar a una tienda y tocar **Al carrito** en un producto.
3. En PostHog (proyecto 525950, US Cloud) → **Activity → Live events**.
4. Esperado: `cart_item_added` con la super property `environment: production` —la registra
   `instrumentation-client.ts` con `posthog.register`— más la URL del producto.

PostHog **no** está detrás del banner de cookies: el consentimiento solo gobierna Meta Pixel
(`ConsentBanner`). Aceptar o rechazar el banner no cambia lo que se envía, así que nunca es la
causa de un evento ausente.

Si `cart_item_added` no aparece en un par de minutos, revisar en este orden: que el token del
build sea el del proyecto que estás mirando (13.4), el navegador (bloqueador de anuncios) y por
último la vista elegida en PostHog (un filtro de `environment`).

**Cómo saber que el SDK arrancó aunque no veas ningún evento.** Al inicializar, `posthog-js` pide
`/ingest/array/<token>/config.js` y los scripts de `/ingest/static/`, y escribe la cookie
`ph_phc_<token>_posthog` con `$device_id`, `distinct_id`, `$sesid` y `$user_state`. Si esa cookie
existe con `$user_state: "anonymous"` y esos requests dan `200`, `posthog.init` corrió y el
visitante anónimo quedó registrado: lo que falte es transporte o vista, no inicialización. Si la
cookie no existe, el problema está antes y el token no tiene nada que ver.

En un navegador headless la cookie se crea igual, pero **no sale ningún `POST` a
`/ingest/i/v0/e`**: `_is_bot()` corta la captura. Es el comportamiento esperado, no una falla, y es
la razón por la que no se puede automatizar esta verificación.

### 13.4 Cuando no aparece ningún evento: qué descartar y en qué orden

**`defaultIdentifiedOnly: true` no descarta eventos anónimos.** Es la opción por defecto de
PostHog (`person_profiles: 'identified_only'`) y solo evita crear person profiles para visitantes
anónimos: los eventos se guardan igual. Lo confirma la documentación oficial de "Anonymous vs
identified events". No es la causa de un evento ausente y no hay nada que cambiar en la UI por
esto.

Lo que sí hay que verificar, en orden:

1. **El token del build contra el del proyecto que estás mirando.** El token es lo único que
   decide a qué proyecto entra un evento. Si no coinciden, el SDK envía, PostHog responde `200`
   y nada aparece en la pantalla equivocada. Se compara así:

   - En PostHog: **Project Settings → Project API key**, copiar el `phc_...`.
   - En el navegador, con la tienda abierta: DevTools → **Application → Cookies** → buscar la
     cookie `ph_phc_<token>_posthog`. Ese `<token>` es el que usa la página.

   Si no coincide, el build apunta a otro proyecto y ahí están tus eventos. Si la cookie no
   existe, el SDK no llegó a inicializar: el paso 1 no aplica y hay que mirar 13.3.

2. **El evento de prueba.** Un `POST` manual a `/ingest/i/v0/e` con el token del build y un
   evento `diagnostic_probe` debe aparecer en **Activity → Live events** sin filtros. Si no
   aparece, ese token no apunta al proyecto que estás viendo.

3. **El navegador.** Un bloqueador de anuncios corta el request antes de salir; probar en una
   ventana limpia o en otro navegador.

4. **La vista.** `environment` se guarda como super property; un filtro por ese valor deja fuera
   todo lo que no lo tenga. Live events muestra lo que se ingiere ahora, no el histórico.

### 13.5 Verificar el túnel de ingesta sin navegador

`posthog-js` publica en `/ingest/i/v0/e/`, con barra final. Next normaliza esa barra con un
**308** hacia `/ingest/i/v0/e`, que es la forma que sí matchea el rewrite `/ingest/:path*`.
Los navegadores repiten el POST con su cuerpo en un 308 (verificado con `fetch`), así que el
redirect cuesta un round-trip extra pero no pierde eventos. No se "arregla" con
`skipTrailingSlashRedirect`: es global y duplicaría la URL de cada tienda.

Para probar el túnel desde la terminal:

```bash
node -e "fetch('https://storelite.app/ingest/i/v0/e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:'phc_...',event:'diagnostic_probe',properties:{distinct_id:'diagnostic-probe'}})}).then(async r=>console.log(r.status,await r.text()))"
```

Esperado: `200 {"status":"Ok"}`, que prueba que el rewrite, el bypass del middleware y el payload
son válidos. No prueba que el evento se guarde ni en qué proyecto: eso lo resuelve el checklist
de 13.4.

Un `400` significa que el cuerpo llegó vacío o inválido. No usar `curl` para esta verificación:
al seguir el 308 no repite el cuerpo del POST y devuelve un `400` que parece una falla del túnel
pero es del cliente.

Si el probe devuelve HTML o `404`, el problema es el rewrite de `next.config.ts` o el bypass del
middleware (`src/lib/middleware/proxyBypass.ts`), no el token. `resolvePostHogKey()` prioriza
`NEXT_PUBLIC_POSTHOG_KEY` sobre `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, y los `NEXT_PUBLIC_*` se
inlinean en build: cambiarlos exige redeploy.
