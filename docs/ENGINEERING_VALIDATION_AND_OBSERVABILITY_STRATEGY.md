# Store Lite — Engineering Validation & Observability Strategy

**Estado:** propuesta de trabajo (no ejecutada)
**Base:** auditoría directa sobre `develop` (`b5a609b`) + estrategia externa consolidada
**Objetivo:** definir cómo validar Store Lite antes del lanzamiento a usuarios reales, y cómo mantener esa validación después.

Este documento no declara que Store Lite esté lista para producción. Declara qué vamos a medir, con qué, en qué entorno y bajo qué criterios.

---

## 1. Contexto verificado del proyecto

Todo lo siguiente fue comprobado contra el código, no asumido.

| Aspecto            | Realidad verificada                                    | Evidencia                                            |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------- |
| Framework          | Next.js 16.2.9, App Router, React 19.2.3               | `package.json`                                       |
| Lenguaje           | TypeScript 5.9.3                                       | `package.json`                                       |
| Hosting            | Vercel                                                 | `docs/deployment.md`                                 |
| Base de datos      | Supabase PostgreSQL vía `postgres.js` + Drizzle 0.45.2 | `src/core/database/client.ts`                        |
| Pool de conexiones | `max: 10` por instancia                                | `src/core/database/client.ts:37`                     |
| Auth               | Supabase Auth (`@supabase/ssr`)                        | `src/lib/supabase/`                                  |
| Pagos              | Culqi (Perú) vía Route Handlers                        | `app/api/payment/*`, `app/api/webhooks/culqi`        |
| Mensajería         | YCloud / Twilio, Resend para email                     | `app/api/webhooks/ycloud`, `src/lib/email`           |
| Errores            | Sentry 10.58.0 (client + edge + server + build plugin) | `sentry.*.config.ts`                                 |
| Producto           | PostHog (cliente y servidor)                           | `posthog-js`, `posthog-node`                         |
| Multitenancy       | Rutas por `/{slug}` + rewrite por subdominio           | `app/[slug]/`, `src/lib/middleware/proxyPipeline.ts` |
| Superficie API     | 43 Route Handlers + Server Actions                     | `app/api/**/route.ts`                                |

---

## 2. Auditoría de validación: qué ya existe y qué falta

### 2.1 Ya implementado (no reconstruir)

| Capacidad                     | Estado     | Evidencia                                                       |
| ----------------------------- | ---------- | --------------------------------------------------------------- |
| Lint + type-check en CI       | ✅         | `.github/workflows/ci.yml` → `pnpm lint && pnpm type-check`     |
| Encoding y formato en CI      | ✅         | `check:encoding`, `format:check`                                |
| Guard de drift de migraciones | ✅         | `check:migrations` (C9)                                         |
| Auditoría de dependencias     | ✅         | `pnpm audit --prod` con 3 excepciones documentadas              |
| Tests unitarios               | ✅         | Vitest, **177 archivos** en `tests/unit/`                       |
| Tests E2E                     | ⚠️ Parcial | Playwright configurado, **solo 3 specs**: `auth`, `home`, `seo` |
| Artefactos de cobertura       | ✅         | `upload-artifact` en CI                                         |
| Captura de errores            | ✅         | Sentry en los tres runtimes                                     |
| Analytics de producto         | ✅         | PostHog                                                         |

### 2.2 Ausente (a construir)

| Capacidad                                   | Estado                                              | Prioridad                     |
| ------------------------------------------- | --------------------------------------------------- | ----------------------------- |
| Entorno de staging documentado              | ❌                                                  | **Bloqueante**                |
| Suite de performance (k6)                   | 🟡 parcial — `smoke` + `storefront-read` operativos | Alta                          |
| Análisis estático de seguridad (Semgrep)    | ❌                                                  | Alta                          |
| Escaneo web (OWASP ZAP baseline)            | ❌                                                  | Media                         |
| Tests explícitos de aislamiento multitenant | ❌                                                  | **Alta**                      |
| Runbook de observabilidad                   | ❌                                                  | Media                         |
| Análisis estático nativo (CodeQL)           | ❌                                                  | Alta — gratis en repo público |
| Testing E2E asistido por IA (TestSprite)    | ❌                                                  | Opcional                      |
| OpenTelemetry                               | ❌                                                  | Baja (diferir)                |

> **Nota de infraestructura:** el repositorio es **público** (`DevKitTop/Store-Lite-EIRL`). Esto tiene dos consecuencias: CodeQL es gratuito sin GitHub Advanced Security, y cualquier secreto que llegue al historial queda expuesto mundialmente (ver hallazgo C8 en `PREPRODUCTION_READINESS_2026-10.md`).

### 2.3 Corrección a la estrategia recibida

La propuesta externa sugiere "estudiar la posibilidad de integrar posteriormente TypeScript, ESLint, Playwright y auditoría de dependencias en CI". **Eso ya está hecho.** No se debe reimplementar; solo extender.

---

## 3. Principio de arquitectura: cada herramienta tiene un rol

No se sustituyen entre sí.

| Herramienta           | Resuelve                                              | Produce                                             | No puede hacer                                      |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------- |
| **k6**                | Carga y estrés controlado                             | p50/p95/p99, RPS, tasa de error, saturación         | No valida lógica de negocio ni seguridad            |
| **Playwright**        | Recorridos funcionales reales                         | Pass/fail por flujo de usuario                      | No mide capacidad bajo concurrencia                 |
| **Semgrep**           | Patrones inseguros en el código                       | Hallazgos con regla y línea                         | No ve comportamiento en runtime                     |
| **CodeQL**            | Flujo de datos inseguro (taint tracking)              | Alertas SARIF en Security tab y en el PR            | No entiende reglas de negocio; no ve runtime        |
| **TestSprite**        | E2E/API generado y ejecutado por IA sobre la app viva | Suites en la nube, video por paso, causa raíz       | No analiza código; necesita app viva y credenciales |
| **OWASP ZAP**         | Superficie HTTP en ejecución                          | Alertas pasivas/activas                             | No entiende reglas de negocio ni tenancy            |
| **Vitest**            | Unidades y contratos                                  | Cobertura por función                               | No detecta integración rota                         |
| **Sentry**            | Errores y trazas reales                               | Stack traces, issues, performance                   | No genera carga                                     |
| **Vercel / Supabase** | Estado de infraestructura                             | Invocaciones, cold starts, conexiones, slow queries | No correlacionan negocio                            |
| **Grafana**           | Visualización y centralización                        | Dashboards, alertas                                 | No genera datos por sí sola                         |

**Regla:** no se instala el stack autogestionado de Grafana (Loki, Tempo, Mimir, Pyroscope, Alloy) sin demostrar necesidad. Para Store Lite, hoy, no la hay.

---

## 4. Entornos

| Entorno               | Next.js            | Supabase                            | Datos                       | Pruebas permitidas                                    |
| --------------------- | ------------------ | ----------------------------------- | --------------------------- | ----------------------------------------------------- |
| **Development**       | Local (`pnpm dev`) | Local o proyecto de dev             | Semilla / ficticios         | Unit, E2E, k6 smoke local                             |
| **Staging / Preview** | Vercel Preview     | **Proyecto Supabase independiente** | Ficticios, volumen realista | k6 completo, ZAP baseline, E2E, Semgrep               |
| **Production**        | Vercel Production  | Supabase de producción              | Reales                      | Solo observabilidad pasiva. **Nunca** carga ni estrés |

### 4.1 Estado actual

| Activo                        | Existe                | Observación                                                    |
| ----------------------------- | --------------------- | -------------------------------------------------------------- |
| Supabase Producción           | ✅                    | Datos y usuarios reales                                        |
| Supabase Desarrollo (cloud)   | ✅                    | Proyecto `likloeyrdzfsrwelpdoz` — **se reasigna como staging** |
| Supabase Staging              | ✅ (por reasignación) | Es el proyecto dev cloud; no requiere proyecto nuevo           |
| Supabase local (CLI + Docker) | ✅                    | `config.toml` creado, stack corriendo en `127.0.0.1:54321`     |
| Vercel Preview                | ✅                    | Ya apunta al proyecto `likloeyrdzfsrwelpdoz` (staging)         |

- Los archivos `.env*` locales están correctamente ignorados; solo `.env.example` está trackeado.
- **Riesgo:** sin staging separado, cualquier prueba de carga termina apuntando a producción o contaminando la base de desarrollo.

### 4.2 ¿La base de desarrollo sirve como staging?

**No directamente.** Una base de desarrollo no puede hacer de staging por tres razones concretas:

1. **Volumen irreal.** Se resetea y se siembra con pocos registros. Los índices se comportan distinto con 10 productos que con 2000, así que los números de k6 serían ficción.
2. **Contaminación cruzada.** ZAP y k6 **escriben filas**. Esos registros quedan en la misma base donde después se desarrolla, y se depuran bugs contra basura de prueba.
3. **Preview sin control.** Todo PR apunta a esa base. Cualquier rama, incluida una de un colaborador, escribe ahí.

### 4.3 Tres opciones para resolverlo

| Opción                                                                     | Costo               | Ventaja                                          | Desventaja                                        |
| -------------------------------------------------------------------------- | ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| **A. Supabase local para dev + reusar el proyecto dev cloud como staging** | $0                  | Sin proyecto nuevo; separa desarrollo de pruebas | Requiere Docker + `supabase init` en cada máquina |
| **B. Crear un tercer proyecto Supabase**                                   | Plan Pro (~$25/mes) | Aislamiento total                                | El plan gratuito solo permite 2 proyectos activos |
| **C. Seguir usando dev para todo**                                         | $0                  | Cero trabajo                                     | Los resultados de carga no son confiables         |

**Decisión tomada: opción A.** Es la única que da aislamiento real sin costo, y de paso incorpora Supabase local para desarrollo, que hoy no existe.

### 4.3.1 Prerrequisitos verificados de la opción A

| Requisito               | Estado                                                      |
| ----------------------- | ----------------------------------------------------------- |
| Docker instalado        | ✅ v29.5.3                                                  |
| Docker daemon corriendo | ❌ Docker Desktop apagado                                   |
| Supabase CLI en PATH    | ❌ No instalado globalmente                                 |
| Supabase CLI vía `npx`  | ✅ Usable (`supabase/.temp/cli-latest` confirma uso previo) |
| `supabase/config.toml`  | ❌ No existe — requiere `supabase init`                     |

### 4.4 ¿Es remoto o local?

**Remoto, y no requiere infraestructura propia.** El staging natural para este proyecto es:

```text
Vercel Preview (rama develop)  →  Proyecto Supabase de staging  →  datos ficticios con volumen realista
```

No hace falta un servidor, ni Kubernetes, ni Docker en producción. Solo dos variables de entorno distintas en el scope Preview de Vercel.

### 4.5 ¿En qué flujos NO hace falta staging?

Para ser precisos: staging **no** es necesario para todo.

| Flujo                     | ¿Necesita staging?                         |
| ------------------------- | ------------------------------------------ |
| Tests unitarios (Vitest)  | No                                         |
| Revisión visual de un PR  | No — Vercel Preview ya alcanza             |
| Lint, tipos, formato      | No                                         |
| Tests E2E de Playwright   | No (alcanza local o CI con base de prueba) |
| **Pruebas de carga k6**   | **Sí**                                     |
| **OWASP ZAP**             | **Sí**                                     |
| **TestSprite**            | **Sí** (crea y borra registros)            |
| **Ensayo de migraciones** | **Sí**                                     |

### 4.6 Requisitos antes de la primera prueba remota

1. Proyecto Supabase de staging (o el de desarrollo reasignado como tal).
2. Vercel Preview apuntando a ese proyecto (verificar que las variables de Preview **no** sean las de producción).
3. Dataset con volumen realista: 1 tienda con 500–2000 productos, categorías y pedidos.
4. Proveedores externos (Culqi, YCloud, Resend) mockeados o deshabilitados.

---

## 5. Fase 1 — Performance con Grafana k6

### 5.1 Estructura propuesta

```text
tests/performance/k6/
  lib/
    config.js        # ✅ baseURL, perfiles, think time, thresholds desde env
    data.js          # ✅ slugs y builders de URL
    auth.js          # ✅ password grant contra Supabase Auth
  scenarios/
    smoke.js            # ✅ implementado
    storefront-read.js  # ✅ implementado
    api-ratelimit.js    # ✅ implementado
    order-lookup.js     # ✅ implementado (usa el pedido sembrado)
    auth-session.js     # ✅ implementado
    checkout-mocked.js  # ⛔ bloqueado: POST /api/payment/create-order exige sesión y llama a Culqi real; no hay seam de mock
    cron-concurrent.js  # ⏳ pendiente
  results/           # reportes JSON por ejecución
  README.md          # ✅ implementado
```

Perfiles disponibles sin editar código: `smoke` (1 min, 2 VUs), `baseline` (10 min, 10 VUs), `load` (20 min, 20 VUs), `stress` (rampa a 100 VUs), `spike` (0 → 100 en 10 s), `soak` (2 h al 25%).

### 5.2 Requisitos técnicos

- JavaScript compatible con **k6 v1.8.2** (ya instalado en la máquina).
- URLs, VUs y duración configurables por variables de entorno.
- `tags` por endpoint para poder desglosar resultados.
- Checks HTTP **y** de contenido esperado, no solo status code.
- Separación explícita entre escenarios de lectura y de escritura.

### 5.3 Escenarios y orden de implementación

| #   | Escenario         | Tipo         | Qué responde                                   |
| --- | ----------------- | ------------ | ---------------------------------------------- |
| 1   | `storefront-read` | Smoke → Load | ¿Aguanta el tráfico anónimo real?              |
| 2   | `api-ratelimit`   | Load         | ¿El limitador respaldado por DB escala?        |
| 3   | `order-lookup`    | Load         | Consulta de pedido bajo bucket `orderVerifyIp` |
| 4   | `auth-session`    | Load         | Login Supabase con usuarios distintos          |
| 5   | `checkout-mocked` | Load         | Lógica propia de checkout sin proveedor real   |
| 6   | `cron-concurrent` | Spike        | Cron compitiendo con tráfico de usuarios       |

### 5.4 Etapas de ejecución

| Etapa    | Configuración           | Objetivo                              |
| -------- | ----------------------- | ------------------------------------- |
| Smoke    | 1–2 VUs, 1 min          | Los scripts funcionan                 |
| Baseline | 10 VUs, 10 min          | Establecer la línea base real         |
| Load     | Pico esperado, 20 min   | ¿Aguanta el lanzamiento?              |
| Stress   | Rampa hasta degradación | ¿Dónde y cómo falla?                  |
| Spike    | 0 → pico en 10 s        | Escenario "link viral"                |
| Soak     | 2–4 h al 50% del pico   | Fugas de conexión y degradación lenta |

**Los thresholds se calibran contra el baseline medido.** No se inventan objetivos de latencia ni límites de usuarios antes de tener la primera medición.

### 5.5 Advertencia metodológica

Un resultado de k6 describe **el escenario probado**, no una capacidad universal de la plataforma. `200 VUs sostenidos` significa "este mix, con estos datos, en este entorno, respondió así". Cambiar el mix, el volumen de datos o la región invalida la comparación.

### 5.6 Primera medición local (2026-11-01)

Servidor de desarrollo en `localhost:3000` contra Supabase local, con el seed aplicado y el compilador ya caliente.

| Escenario         | Perfil       | Checks         | `http_req_failed` | p(95)  |
| ----------------- | ------------ | -------------- | ----------------- | ------ |
| `smoke`           | 2 VUs, 1 min | 150/150 (100%) | 0%                | 385 ms |
| `storefront-read` | 2 VUs, 1 min | 240/240 (100%) | 0%                | 244 ms |

**Cómo leer esto:** son números de un servidor de desarrollo en una laptop, no capacidad de plataforma. En frío la primera petición llegó a 19,6 s por compilación de Next; medir sin calentar invalida cualquier resultado. `K6_P95_MS` queda **sin definir** hasta tener el baseline de staging.

### 5.7 Qué mide `api-ratelimit` (2026-11-01)

35 sondas secuenciales contra `/api/auth/user`, desde un solo cliente:

| Observación       | Valor                      |
| ----------------- | -------------------------- |
| Permitidas        | 30                         |
| Bloqueadas (429)  | 5                          |
| Primera bloqueada | sonda 31                   |
| `Retry-After`     | numérico en las bloqueadas |

El presupuesto configurado se respeta con exactitud. Pero el escenario destapó algo más importante que el número.

**Hallazgo de arquitectura:** `checkRateLimit` (`src/lib/rateLimit.ts:71`) es síncrono y usa una `Map` **en memoria por proceso**. El almacén compartido en Postgres se escribe _fire-and-forget_ (`getShared()` más `.catch(() => {})`, líneas 87-108) y su resultado **nunca se lee** en ese camino. Con N instancias, el límite efectivo es N × el configurado, y cada instancia nueva arranca con el balde vacío. `checkRateLimitAsync` sí consulta el compartido, pero el pipeline del edge usa la variante síncrona.

Eso responde la pregunta 2 de §5.3 —"¿el limitador respaldado por DB escala?"— con un **no**: en el camino que realmente aplica el límite, no hay DB. Es el mismo defecto de fondo que R12, visto desde el otro lado.

### 5.8 Medición de autenticación (2026-11-01)

`auth-session` contra Supabase local, perfil `smoke` (2 VUs, 1 min):

| Métrica           | Valor |
| ----------------- | ----- |
| Logins ejecutados | 1.611 |
| Fallos            | 0     |
| p(95)             | 59 ms |

Cada iteración es un password grant real contra GoTrue. Con 2 VUs no hay tensión: esto es una línea base de latencia, no una prueba de carga. GoTrue corre fuera de este repositorio y escala por separado, así que el número describe a Supabase, no a Next.

El escenario exige las credenciales por variable de entorno y aborta si falta alguna. No hay usuario ni contraseña en el repositorio.

### 5.9 Primera medición válida en staging (2026-11-01)

> **Antes de esto hubo un error y se conserva como registro.** El preview estaba detrás de **Deployment Protection** y respondía `200` con `Login – Vercel` en todas las rutas. La detección falló porque ese título usa un **en dash** (U+2013) y el marcador comparaba un guion ASCII: nunca coincidió. Se llegó a registrar un "baseline" de 10 minutos contra la pantalla de login. Corregido con regex en `lib/data.js`; con la pared presente, `smoke` da ahora **74/148** checks en vez de pasar entero.

Acceso: bypass de Deployment Protection por cabecera, con un secret de 32 caracteres cargado en el proyecto `store-lite-eirl`. Sin él no hay medición posible: cualquier número describe la pantalla de Vercel.

| Escenario         | Perfil       | Requests | Checks  | Fallos | p(95)  |
| ----------------- | ------------ | -------- | ------- | ------ | ------ |
| `smoke`           | 2 VUs, 1 min | 38       | 152/152 | 0%     | 1,50 s |
| `storefront-read` | 2 VUs, 1 min | 46       | 184/184 | 0%     | 1,50 s |
| `order-lookup`    | 2 VUs, 1 min | 51       | 204/204 | 0%     | 820 ms |

**Baseline (`storefront-read`, 10 VUs, 10 minutos):**

| Métrica     | Valor                  |
| ----------- | ---------------------- |
| Iteraciones | 1.321                  |
| Requests    | 2.642                  |
| Checks      | 10.568 / 10.568 (100%) |
| Fallos      | **0**                  |
| p(50)       | 1,35 s                 |
| p(90)       | 1,68 s                 |
| p(95)       | **1,78 s**             |
| Máximo      | 3,36 s                 |
| Abortos     | ninguno                |

**Threshold recomendado:** `K6_P95_MS=2700`, aproximadamente 1,5× el p95 medido.

**Cómo leerlo:** 10 VUs no saturan nada: cero fallos y ningún aborto. La mediana (1,35 s) supera al promedio (1,14 s), señal de que la distribución tiene una cola de arranques en frío más que una degradación progresiva. Son números de una ventana concreta, no una capacidad declarada.

**Qué no prueba:** nada sobre 100 VUs, escrituras ni checkout. Y no es comparable con las cifras retiradas: aquellas medían otra cosa.

**Estado:** Fase 0 cerrada en estructura (catálogo idéntico, 0 diferencias) y en funcional (los tres escenarios en verde contra staging real).

---

## 6. Fase 2 — Funcional con Playwright

### 6.1 Estado

- Configuración existente: `playwright.config.ts`, `testDir: ./tests/e2e`, Chromium únicamente, `baseURL: http://localhost:3000`.
- En CI arranca con `next dev`, no con build de producción. **Es una diferencia relevante**: dev es más lento y no refleja el comportamiento real.

### 6.2 Brechas a cubrir

| Flujo                           | Existe            | Acción   |
| ------------------------------- | ----------------- | -------- |
| Home pública                    | ✅ `home.spec.ts` | Mantener |
| Auth                            | ✅ `auth.spec.ts` | Mantener |
| SEO / metadata                  | ✅ `seo.spec.ts`  | Mantener |
| Abrir tienda por slug           | ❌                | Agregar  |
| Navegar catálogo y producto     | ❌                | Agregar  |
| Checkout con proveedor mockeado | ❌                | Agregar  |
| Administración de productos     | ❌                | Agregar  |
| Consulta de pedido              | ❌                | Agregar  |

### 6.3 Reglas

- Cuentas de prueba dedicadas; nunca cuentas reales.
- Sin pagos reales, sin OTP reales, sin mensajes reales.
- No duplicar los 177 tests unitarios existentes: E2E cubre integración, no unidades.
- Evaluar migrar el `webServer` de CI a `pnpm build && pnpm start`.

### 6.4 TestSprite (opcional)

**Qué es:** un agente de testing autónomo. No analiza el código fuente; abre la aplicación viva con un navegador, la explora como un usuario, genera casos E2E y de API, los ejecuta en sandboxes en la nube y devuelve el fallo con capturas, DOM, causa raíz y fix sugerido. Exporta el resultado como Playwright.

**Qué NO es:** no es análisis estático. No detecta un `service_role` expuesto en una ruta, ni una query sin validación de tenancy. Eso lo cubren CodeQL y los tests escritos a mano.

**Qué problema resolvería acá:** arrancar cobertura E2E rápido. Hoy hay 3 specs para un producto con 43 rutas y un storefront multitenant. TestSprite puede generar en minutos lo que a mano llevaría semanas.

**Requisitos:** URL de staging + credenciales de prueba + idealmente un PRD. Este repo tiene documentación extensa en `docs/` que puede servir como PRD.

**Riesgos a evaluar antes de adoptarlo:**

- Es una plataforma comercial; implica costo y dependencia externa.
- Se solapa con Playwright. Mantener ambos sin criterio genera dos suites y duplicación de mantenimiento.
- Un test generado a partir del comportamiento actual puede **codificar un bug como comportamiento correcto** si no está anclado a un PRD.
- Corre contra tu app: crea y borra registros. Sin staging, no se puede usar.

**Veredicto:** _nice to have_, no prioritario. Primero cerrar staging + k6 + tests de tenancy. Si después de eso la cobertura E2E sigue siendo el cuello, TestSprite es un acelerador legítimo.

---

## 7. Fase 3 — Seguridad

### 7.1 CodeQL (estático, nativo de GitHub)

**Qué es:** el motor de análisis semántico de GitHub. Construye una base de datos del código y rastrea flujos de datos — desde una entrada no confiable hasta un sink peligroso (`taint tracking`). Soporta JavaScript y TypeScript, que es todo lo que necesita este repo.

**Costo:** **gratis**, porque el repositorio es público. En un repo privado requeriría GitHub Advanced Security.

**Por qué encaja particularmente bien acá:** el riesgo dominante de Store Lite no es un patrón suelto, es **datos de un tenant llegando a otro**. El taint tracking es exactamente la técnica que detecta ese tipo de flujo.

**Cómo se activa (estado real, 2026-11-01):** se intentó primero la vía sin YAML, _Settings → Code security → CodeQL default setup_. El API del repositorio siguió respondiendo `state: not-configured` con `updated_at: null`, sin análisis y sin alertas, así que esa vía no quedó efectiva. La configuración se pasó a un workflow versionado: `.github/workflows/codeql.yml`.

**Por qué el workflow y no el ajuste del repositorio:**

- Es determinista y revisable: la configuración vive en el repo, no en un clic invisible.
- No exige permisos de administrador para verificarla; el estado se comprueba por API.
- Corre en cada PR además de `develop` y `main`, más un análisis semanal para recibir query packs nuevos.

Los resultados aparecen en la pestaña Security y como anotaciones en el PR. Usa el query suite por defecto (seguridad); `security-and-quality` se puede activar después si hace falta más cobertura, a costa de ruido que ESLint ya cubre.

**Qué NO puede hacer:** no entiende que `businessId` debe pertenecer al usuario. Un flujo puede ser técnicamente limpio y seguir siendo un bug de autorización. Eso lo cubren los tests de 7.5.

**Decisión: adoptada.** Es la única herramienta de análisis estático del stack.

**Primer análisis (2026-11-01):**

| Métrica           | Valor               |
| ----------------- | ------------------- |
| Workflow `CodeQL` | success, 1m36s      |
| Query suite       | default (seguridad) |
| Reglas evaluadas  | 87                  |
| Resultados        | **0**               |
| Alertas abiertas  | 0                   |

**Cómo leerlo:** el suite por defecto no encontró ningún flujo de datos no confiable llegando a un sink peligroso. Eso es bueno y **no** significa "sin vulnerabilidades". CodeQL no entiende reglas de negocio: un `businessId` que llega del cliente y se usa sin verificar propiedad puede ser técnicamente limpio y seguir siendo un fallo de autorización entre tenants. Esa clase de bug la cubren los tests de 7.5, no el escáner.

Tampoco es una foto definitiva: las reglas se actualizan y el análisis corre semanal, así que un resultado limpio hoy describe el código de hoy con las reglas de hoy.

### 7.2 Semgrep — descartada (por ahora)

Se evaluó y se descartó por solapamiento: cubre más del 80% de lo mismo que CodeQL, pero exige configuración adicional (Docker o `pipx`) y mantenimiento de reglas propias.

**Cuándo reconsiderarla:** si aparece una necesidad que CodeQL no cubra, por ejemplo una regla específica del dominio multitenant de Store Lite (detectar `businessId` proveniente de input sin `requireOwnedBusinessById`). En ese momento se evalúa con una regla concreta, no como adopción general.

### 7.3 OWASP ZAP (dinámico)

- **Solo contra staging.** Nunca contra producción.
- Comenzar con **Baseline Scan** (pasivo + spider). No ejecutar escaneos activos hasta definir alcance y efectos secundarios.
- Un spider sobre rutas autenticadas crea sesiones y filas: por eso staging es obligatorio, no opcional.

### 7.4 Dependencias

- `pnpm audit --prod` ya corre en CI con tres excepciones documentadas.
- **Deuda conocida:** `xlsx` (SheetJS CE) está EOL y sus correcciones solo existen en la versión Pro. Solo afecta imports Excel de administración.
- Acción: registrar esta deuda como riesgo aceptado con fecha de revisión, o evaluar reemplazo.

### 7.5 Aislamiento multitenant (prioridad máxima)

Esto **no lo detecta ningún escáner**. Requiere tests escritos a mano.

| Verificación                                      | Estado                                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Un usuario no lee datos de otra tienda            | ✅ Verificado — 8/8, `pnpm check:tenancy` (2026-11-01)   |
| Server Actions validan membresía                  | Parcialmente cubierto (C6 en auditoría previa)           |
| Route Handlers validan ownership                  | 🟡 2 endpoints verificados (2026-11-01); resto pendiente |
| Acceso a archivos e imágenes aislado              | A verificar                                              |
| Operaciones administrativas protegidas            | A verificar                                              |
| `x-sass-key` y `platformAdminIds` no bypasseables | A verificar                                              |

#### Lo verificado (2026-11-01)

`scripts/tenancy-check.ts` crea dos inquilinos de prueba (`tenancy-a`, `tenancy-b`) con usuarios reales en Supabase Auth, y ataca con el token de A:

| Check                                                | Resultado                  |
| ---------------------------------------------------- | -------------------------- |
| `anon` no lista ningún negocio                       | 0 filas                    |
| El dueño lee su propio negocio                       | 1 fila                     |
| El dueño no lee el negocio ajeno                     | 0 filas                    |
| El dueño no lee los pagos ajenos                     | 0 filas                    |
| El listado de pagos propios no contiene filas ajenas | 0 ajenas                   |
| El dueño no puede renombrar un negocio ajeno         | status 200, nombre intacto |
| El dueño no puede borrar un pago ajeno               | status 200, fila intacta   |
| **Control:** `service_role` ve ambos inquilinos      | 2 filas                    |

El control es lo que hace válido al resto: sin él, un fixture que no se creó también devolvería cero filas y todo "pasaría". El `status < 400` en los intentos de escritura descarta además el falso positivo de un token rechazado, que dejaría la fila intacta por el motivo equivocado.

**Lo que esto NO cubre:** solo RLS a nivel de tabla vía PostgREST. No ejercita Server Actions, Route Handlers, rutas de archivos ni endpoints administrativos.

#### Route Handlers (2026-11-01)

Los Route Handlers autentican por cookie SSR, no por cabecera `Authorization`, así que se ejercitaron construyendo la cookie `sb-<ref>-auth-token` del inquilino A a partir de un login real: prefijo `base64-`, payload base64url, en trozos de 3180 bytes. Una cookie mal formada devuelve 401, lo que hace evidente cuándo el montaje falla.

| Endpoint                                          | Resultado                                                      |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `GET /api/business/permissions?businessId=<B>`    | 200, `isOwner: false`, `permissions: []`                       |
| `GET /api/business/penalty-status?businessId=<B>` | 200, solo campos públicos; sin `penaltyDebt` ni `penaltyCount` |

**Hallazgo de baja severidad:** `/api/business/permissions` devuelve además `business.name` y `business.slug` del inquilino consultado, incluso a quien no es miembro. No escala privilegios ni expone datos de clientes, y el slug es público por diseño — es la URL del storefront. Queda registrado como divulgación menor, no como falla de aislamiento. Si preferís cerrarlo, basta omitir el objeto `business` cuando `isOwner` es `false` y `permissions` está vacío.

Los demás Route Handlers (miembros, importaciones, notificaciones, pedidos) siguen sin ejercitar.

**Nota de diseño:** `products` no tiene RLS a propósito — el storefront es público. Leer productos de otra tienda no es un fallo; escribir en ellos sí, y eso lo bloquea la ausencia de políticas de escritura.

Referencia: `docs/PREPRODUCTION_READINESS_2026-10.md` ya clasifica estos hallazgos.

---

## 8. Fase 4 — Observabilidad

### 8.1 Ya disponible

| Fuente   | Uso                                                     |
| -------- | ------------------------------------------------------- |
| Sentry   | Errores, stack traces, performance de transacciones     |
| Vercel   | Invocaciones, cold starts, errores por función          |
| Supabase | Conexiones activas, CPU, slow queries, logs de Postgres |
| PostHog  | Comportamiento de producto                              |

### 8.2 Qué falta

- Un **runbook** que diga, ante una alerta, qué panel mirar primero.
- Correlación explícita entre resultados de k6 y métricas de Supabase durante la misma ventana.

### 8.3 Decisiones

- **OpenTelemetry:** diferir. Vercel soporta OTel drains, pero agrega costo y complejidad sin resolver un problema actual.
- **Grafana Cloud:** opcional y solo para retener resultados de k6 entre versiones. El dashboard web embebido de k6 (`K6_WEB_DASHBOARD=true`) cubre el caso local sin infraestructura.
- **Stack autogestionado (Loki/Tempo/Mimir/Pyroscope/Alloy):** no instalar.

---

## 9. Fase 5 — CI/CD

### 9.1 Ya integrado

Lint, type-check, encoding, migraciones, formato, auditoría de dependencias, tests unitarios con cobertura, E2E, commitlint.

### 9.2 A integrar (incremental)

| Check                   | Momento                            | Costo                 |
| ----------------------- | ---------------------------------- | --------------------- |
| Semgrep                 | Cada PR                            | Bajo                  |
| k6 Smoke                | Cada PR o nightly                  | Bajo (1–2 VUs, 1 min) |
| ZAP Baseline            | Nightly contra staging             | Medio                 |
| k6 Load / Stress / Soak | Manual o release, nunca por commit | Alto                  |

**Regla:** los tests de carga pesados no corren en cada commit. Consumen infraestructura, cuestan dinero y sus resultados no son comparables si el entorno cambia.

### 9.3 Versionado de resultados

Guardar cada ejecución de k6 como artefacto JSON versionado permite comparar entre versiones y detectar regresiones de rendimiento introducidas por un cambio funcional.

---

## 10. Riesgos ya identificados (previos a cualquier test)

Estos salen de leer el código, no de ejecutar carga. Son el motivo por el cual el test de performance tiene sentido.

| #   | Riesgo                                                                              | Evidencia                                                            | Impacto                                                                                 |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| R1  | Storefront hace ~5 operaciones de DB + 1 llamada a Supabase Auth por visita anónima | `app/[slug]/(app)/(home)/page.tsx:115,119,127,135,140,146`           | El tráfico anónimo es la carga más costosa                                              |
| R2  | Sin caché explícita visible en la home del storefront                               | Ausencia de `revalidate` / `unstable_cache`                          | Cada visita paga el costo completo                                                      |
| R3  | `max: 10` conexiones por instancia en serverless                                    | `src/core/database/client.ts:37`                                     | N instancias × 10 puede agotar el pooler de Supabase                                    |
| R4  | Rate limiting respaldado por Postgres                                               | `src/core/payments/rateLimitShared.ts`                               | Cada hit a `/api/*` agrega una operación a la DB                                        |
| R5  | Límites bajos: api 30/min, auth 10/15min, storefront 60/min                         | `src/lib/rateLimit.ts:23-32`                                         | Un test desde una IP devuelve 429 y contamina resultados                                |
| R6  | Cron y webhooks comparten DB con tráfico de usuarios                                | `app/api/cron/*`, `app/api/webhooks/*`                               | Picos de cron degradan la experiencia de compra                                         |
| R7  | `xlsx` EOL con CVEs sin parche en la versión CE                                     | `package.json`, ignores en CI                                        | Deuda de seguridad acotada a imports admin                                              |
| R8  | Drift de versiones local vs CI (Node 24 vs 20, pnpm 11 vs 10)                       | `package.json` vs `ci.yml`                                           | Diferencias que solo aparecen en CI                                                     |
| R9  | **Cadena de migraciones rota: desviada y no reconstruye una base desde cero**       | Ver 10.1                                                             | Sin recuperación ante desastre; staging no se puede provisionar desde el repo           |
| R10 | Integridad del historial de migraciones duplicada                                   | 84 archivos `.sql` vs 24 entradas en `migrations/meta/_journal.json` | Orden indeterminable; migraciones huérfanas                                             |
| R11 | **Base local sin RLS, triggers ni funciones**                                       | `db:push` vs `migrations/` — ver 10.2                                | Desarrollo local no puede detectar fallas de seguridad; validación de tenancy imposible |
| R12 | **Rate limiting DB-backed falla abierto**                                           | `rateLimitShared.ts:74-78` + `rate_limit_windows` ausente en staging | Límites efectivamente desactivados; abuso sin freno (ver 15.2)                          |

### 10.1 Confirmación de R9 (evidencia de ejecución, 2026-10-31)

Reproducido levantando un Postgres limpio (Supabase local) y ejecutando `drizzle-kit migrate`:

```text
applied:        0
public_tables:  0
ERROR: data type text has no default operator class for access method "gin"
HINT:  You must specify an operator class for the index...
STATEMENT: CREATE INDEX "idx_products_title_search" ON "products" USING gin ("title");
```

**Causa:** la primera entrada del journal (`idx 0 -> 0000_superb_master_mold`) crea un índice GIN sobre una columna `text` sin extensión `pg_trgm` ni operador `gin_trgm_ops`. Falla en la primera migración y aborta toda la cadena.

**Agravantes confirmados:**

- `0000_special_crystal.sql:440` define el mismo índice como `btree` (versión válida), pero **no está referenciado por el journal**.
- `0002_add_product_fields.sql` lo elimina y lo vuelve a crear como `btree`.
- No existe ninguna declaración de `pg_trgm` en las 84 migraciones.
- Hay prefijos duplicados: `0000` ×2, `0002` ×2, `0003` ×2, `0013` ×3, etc.

**Consecuencia:** una base vacía **no puede** construirse desde `migrations/`. Esto afecta recuperación ante desastre, provisión de staging y onboarding de nuevos entornos.

**Workaround aplicado (solo local):** `drizzle-kit push --force` contra `127.0.0.1:54322`, que deriva el esquema desde `src/core/database/schema.ts` en lugar de las migraciones. Resultado: 41 tablas en `public`, índice de `products.title` en `btree`. **No se tocó ninguna base remota ni la cadena de migraciones.**

### 10.2 Brecha entre la base local y el esquema de migraciones (2026-10-31)

Medido directamente sobre la base local creada con `db:push`:

| Capa                           | Definido en `migrations/`                    | Presente en la base local |
| ------------------------------ | -------------------------------------------- | ------------------------- |
| Tablas y columnas              | 41                                           | **41**                    |
| Tablas con RLS habilitado      | sí (`0049_enable_rls_sensitive_tables.sql`)  | **0**                     |
| Funciones en `public`          | `handle_new_user`, etc.                      | **0**                     |
| Trigger `on_auth_user_created` | sí (`0029_auto_create_profiles_trigger.sql`) | **no existe**             |
| Extensión `pg_trgm`            | ausente                                      | ausente                   |

**Riesgo:** `drizzle-kit push` reproduce _estructura_, no _comportamiento_. Un desarrollador que trabaje en local no puede detectar una política RLS faltante, un trigger ausente o una función rota, porque localmente **ninguna de esas capas existe**. Ese tipo de falla aparece recién en staging o en producción.

**Consecuencia:** mientras R9 no se resuelva, la base local sirve para trabajo de UI y de datos, pero **no es un entorno válido para validar seguridad, autorización ni aislamiento por tenant**. Toda tarea que toque esas áreas debe verificarse contra staging.

Esto **eleva la prioridad de la decisión §15.2**: no es solo un problema de recuperación ante desastre, es la razón por la que el entorno de desarrollo actual no puede validar la capa de seguridad.

**R1 + R3 + R4 combinados** son la hipótesis central: el cuello de botella de Store Lite no es Next.js, es Supabase.

---

## 11. Criterios de aceptación (go / no-go)

Valores **iniciales, a recalibrar** contra el baseline medido.

| Métrica                                  | Umbral propuesto                  |
| ---------------------------------------- | --------------------------------- |
| p95 storefront                           | < 800 ms                          |
| p99 storefront                           | < 2 s                             |
| Tasa de error (excluyendo 429 esperados) | < 0.5%                            |
| Respuestas 5xx                           | 0                                 |
| Conexiones Supabase                      | < 70% del máximo del pooler       |
| Soak 2 h                                 | Sin degradación > 20% en p95      |
| CodeQL                                   | 0 hallazgos críticos              |
| ZAP Baseline                             | 0 alertas altas sin justificar    |
| Aislamiento multitenant                  | 100% de los casos cubiertos pasan |

Un test que pasa no autoriza el lanzamiento por sí solo. La conclusión debe reflejar alcance y limitaciones de lo medido.

---

## 12. Plan de ejecución con gates

| Fase   | Trabajo                                                                            | Gate de salida                                                                         |
| ------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **0a** | Levantar Supabase local (`supabase init` + `supabase start`) con Docker corriendo  | ✅ `http://127.0.0.1:54321` responde                                                   |
| **0b** | Reasignar el proyecto Supabase dev cloud como staging y apuntar Vercel Preview ahí | Preview usa credenciales de staging, nunca las de producción                           |
| **0c** | Verificar separación de credenciales entre los tres entornos                       | Checklist de variables aprobado                                                        |
| **1**  | Cargar dataset con volumen realista en staging                                     | 500+ productos, pedidos de prueba                                                      |
| **2**  | Implementar k6 `storefront-read` + smoke                                           | 🟡 Scripts implementados, 100% de checks verdes en local; falta correr en staging      |
| **3**  | Ejecutar baseline y fijar thresholds                                               | Baseline documentado                                                                   |
| **4**  | Load, Stress, Spike, Soak                                                          | Resultados con evidencia                                                               |
| **5**  | Ampliar Playwright a los flujos faltantes                                          | Flujos críticos cubiertos                                                              |
| **6**  | CodeQL + ZAP Baseline + tests de tenancy                                           | 🟡 CodeQL activo y sin hallazgos (87 reglas, 0 alertas); faltan ZAP y tests de tenancy |
| **7**  | Runbook de observabilidad                                                          | Documentado y probado                                                                  |
| **8**  | Integración CI incremental                                                         | CodeQL + k6 smoke en PR                                                                |

---

## 13. Reglas obligatorias

- No modificar lógica de negocio para facilitar pruebas.
- No imprimir secretos ni valores de `.env`.
- No modificar datos de producción.
- No ejecutar pruebas destructivas.
- No realizar compras ni transferencias reales.
- No enviar OTP, correos ni WhatsApp reales.
- No ejecutar estrés contra producción.
- No introducir infraestructura innecesaria.
- No instalar dependencias sin justificar su utilidad.
- No hacer commit ni push sin autorización.
- Antes de cualquier prueba remota de carga: presentar objetivo, volumen, duración, riesgos y condiciones de aborto.

---

## 14. Entregables

1. Informe de auditoría actual — **parcialmente cubierto por este documento**.
2. Diagrama de arquitectura de validación.
3. Matriz de entornos y responsabilidades — **sección 4**.
4. Scripts k6 funcionales — **parcial**: `smoke` y `storefront-read` implementados y verificados; faltan los otros cinco escenarios de §5.3.
5. Pruebas Playwright faltantes.
6. Configuración de Semgrep y ZAP.
7. Recomendaciones de observabilidad — **sección 8**.
8. README de la suite de performance — **cubierto**: `tests/performance/k6/README.md`.
9. Comandos PowerShell documentados.
10. Plan de ejecución antes del lanzamiento — **sección 12**.

---

## 15. Decisiones tomadas

| #   | Decisión                                                                                              | Estado     |
| --- | ----------------------------------------------------------------------------------------------------- | ---------- |
| D1  | **Staging:** opción A — Supabase local para desarrollo + reasignar el proyecto dev cloud como staging | ✅ Cerrada |
| D2  | **Análisis estático:** CodeQL. Semgrep descartada por solapamiento                                    | ✅ Cerrada |
| D3  | **Stack Grafana autogestionado:** no instalar                                                         | ✅ Cerrada |
| D4  | **OpenTelemetry:** diferir                                                                            | ✅ Cerrada |
| D5  | **TestSprite:** evaluar solo si la cobertura E2E sigue siendo el cuello tras la fase 5                | ✅ Cerrada |

### 15.1 Estado de la Fase 0

| Paso | Acción                                                        | Estado                                                                          |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1    | Abrir Docker Desktop y verificar el daemon                    | ✅ v29.5.3                                                                      |
| 2    | `npx supabase init` (crea `supabase/config.toml`)             | ✅ Hecho                                                                        |
| 3    | `npx supabase start` (Postgres + Auth + Storage local)        | ✅ Corriendo en `127.0.0.1:54321`                                               |
| 4    | Provisionar el esquema local                                  | ✅ Vía baseline forward-only (ver 15.2); `db:push` quedó descartado             |
| 5    | Reasignar Vercel Preview al proyecto staging                  | ✅ Ya apuntaba a `likloeyrdzfsrwelpdoz` (dev)                                   |
| 6    | Confirmar que producción no comparte credenciales con staging | ⚠️ Parcial: Preview = dev confirmado; Production ilegible por marca `SENSITIVE` |
| 7    | Apuntar el desarrollo local a Supabase local (`127.0.0.1`)    | ✅ Hecho: `.env` — 4 claves, 44 antes/después, conexión verificada              |
| 8    | Decidir cómo reparar la cadena de migraciones                 | ✅ Hecho: baseline forward-only en `supabase/migrations/` (ver 15.2)            |
| 9    | Definir cómo poblar la base local (seed o dump)               | ✅ Hecho: `scripts/seed.ts` + `pnpm db:seed`                                    |
| 10   | Aplicar `0002` a staging y verificar paridad de catálogo      | ✅ Hecho: 0 diferencias en 11 categorías                                        |
| 11   | Validar el flujo completo contra el preview de staging        | ✅ Con bypass de Deployment Protection (ver 5.9)                                |

**Evidencia del paso 7 (2026-10-31):** backup en `%TEMP%\opencode\env-backup-20261031-162122.txt`. Solo se reemplazaron `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL`; las otras 40 claves quedaron intactas. Verificación: `select count(*) from businesses` → 0, `information_schema.tables` de `public` → 41, `auth.users` → 0.

> **Corrección importante:** las variables de Supabase y `DATABASE_URL` **viven en `.env`**, no en `.env.local`. `.env.local` solo contiene PostHog, Meta y `VERCEL_OIDC_TOKEN`. Cualquier rotación de entorno debe hacerse sobre `.env` (desarrollo) o `.env.prod` (snapshot de producción).

**Seed local (paso 9):** `scripts/seed.ts`, ejecutado con `pnpm db:seed`.

- Guard: aborta si `NODE_ENV=production`. Los targets locales (`127.0.0.1` / `localhost` / `::1`) corren directo; cualquier otro exige **a la vez** `SEED_CONFIRM=yes` y cada host listado en `SEED_ALLOWED_HOSTS`. Un typo en `DATABASE_URL` no alcanza para escribir en una base remota.
- Escrituras idempotentes: todo es upsert sobre clave natural. Sin `DELETE`, sin `TRUNCATE`.
- Crea el usuario dueño vía Admin API (el trigger `on_auth_user_created` no existe ni en local ni en staging — ver 10.2).
- Alcance: 1 negocio (`demo-store`), 2 categorías, 6 productos, 6 filas de media y 1 pedido determinístico (`DEMO-0001`, token `demo-tracking-token-0001`) que alimenta el escenario `order-lookup`.
- Sembrado en local y en staging el 2026-11-01; el candado se probó apuntando a staging sin `SEED_CONFIRM` y abortó sin escribir.

Verificación ejecutada:

| Check                           | Resultado                                                |
| ------------------------------- | -------------------------------------------------------- |
| Primera corrida                 | 1 business, 2 categorías, 6 productos, 6 media, 1 perfil |
| Segunda corrida                 | Conteos idénticos (idempotencia)                         |
| Guard con `DATABASE_URL` remoto | `ABORT`, nada escrito                                    |
| Guard con `NODE_ENV=production` | `ABORT`                                                  |
| `tsc --noEmit`                  | exit 0                                                   |
| Render real `GET /demo-store`   | 200, ~130 KB, 6 títulos + 2 categorías en el HTML        |

Credenciales locales: `owner@storelite.test` / `Seed1234!` (definidas en el script, solo válidas contra la base local).

**Nota de entorno:** el servidor de desarrollo escucha en `::` (IPv6) y el proxy redirige en loop `http://127.0.0.1:3000`. Usar `http://localhost:3000`.

### 15.2 Reparación de migraciones — RESUELTA (2026-10-31)

**Decisión: opción C, ejecutada como baseline forward-only en `supabase/migrations/`.**

#### Por qué se descartaron A y B

El journal no era el problema principal. `drizzle-kit migrate` aplica solo las 24 entradas del journal, y la última es `0024`. **Todos** los archivos de seguridad están después: `0029` (trigger `on_auth_user_created`), `0040`, `0049`, `0050` (RLS). Arreglar el índice GIN de `0000` habría hecho que la cadena llegue a `0024` y **termine sin ninguna capa de seguridad**.

Además, cualquier edición de `0000_superb_master_mold` cambia el hash de una migración ya aplicada (`drizzle.__drizzle_migrations`), y agregar las 60 entradas faltantes al journal haría que Drizzle reintente DDL que producción ya tiene aplicado a mano.

#### Lo que se construyó

| Archivo                                                  | Contenido                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/0001_public_baseline.sql`           | Esquema completo de `public` extraído del catálogo de **staging**: 42 tablas, 89 constraints, 51 FKs, 146 índices, 17 tablas con RLS, 11 políticas, 2 funciones, 1 trigger |
| `supabase/migrations/0002_forward_code_requirements.sql` | `rate_limit_windows` y `webhook_events`: tablas que el código actual usa y que staging todavía no tiene                                                                    |

El baseline **no se escribió a mano**: se genera por introspección de catálogo (`pg_class`, `pg_attribute`, `pg_constraint`, `pg_index`, `pg_proc`, `pg_trigger`, `pg_policies`, `pg_enum`) contra staging, ordenado por dependencias. Es realidad ejecutada, no reconstrucción teórica.

> `pg_dump` no está disponible en el host ni alcanzable desde el contenedor (el host de staging resuelve solo IPv6 y Docker Desktop no enruta IPv6). La introspección se ejecutó desde Node sobre el host, que sí tiene ruta IPv6.

**Qué NO se tocó:** `migrations/` (historial Drizzle) queda intacto y congelado. `pnpm check:migrations` sigue pasando: 84 sql, 60 manual-only, 21 colisiones de prefijo (grandfathered). El baseline es **adicional y forward-only**: solo aplica a entornos vacíos.

#### Verificación ejecutada

| Check                                          | Resultado                                               |
| ---------------------------------------------- | ------------------------------------------------------- |
| `supabase db reset`                            | exit 0, aplica `0001` + `0002`                          |
| Tablas reconstruidas                           | 44 (42 de staging + 2 forward)                          |
| RLS                                            | 17 tablas, 11 políticas                                 |
| Funciones `public`                             | 2 (`is_business_member`, `prevent_order_number_update`) |
| Trigger `public`                               | 1 (`payments_order_number_immutable`)                   |
| `pnpm db:seed` sobre la base nueva             | 2 categorías, 6 productos, 6 media                      |
| **RLS con `anon`** → `GET /rest/v1/businesses` | **`[]`** (bloqueado)                                    |
| **RLS con `service_role`** → mismo endpoint    | `[{"slug":"demo-store"}]`                               |
| `anon` → `GET /rest/v1/products`               | 200 con filas (storefront público, correcto)            |

#### Consecuencia

R9 y R11 quedan **resueltos para entornos nuevos**. La base local reproduce estructura **y** capa de seguridad, y la validación de tenancy ya es posible en local.

#### Divergencia confirmada contra staging (2026-10-31)

Comparación ejecutada vía PostgREST OpenAPI (staging vs local), más verificación de existencia por endpoint:

| Objeto                   | Staging       | Baseline / local | Detalle                                                                                   |
| ------------------------ | ------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `activity_log`           | existe        | **falta**        | Sin DDL en `migrations/` — esquema invisible                                              |
| `deletion_feedback`      | existe        | **falta**        | Sin DDL en `migrations/` — esquema invisible                                              |
| `payment_chats`          | existe        | **falta**        | Solo en `0000_special_crystal.sql` (fuera del journal) y ausente de `schema.ts`           |
| `payments.shipped_at`    | existe        | **falta**        | En `0000_special_crystal.sql` y `0013_worried_shotgun.sql`, pero `schema.ts` no la modela |
| `payments.verified_at`   | existe        | **falta**        | ídem                                                                                      |
| `payments.rejected_at`   | existe        | **falta**        | ídem                                                                                      |
| `payments.seller_status` | existe        | **falta**        | ídem                                                                                      |
| `rate_limit_windows`     | **no existe** | existe           | `schema.ts` la modela y el código la usa                                                  |
| `webhook_events`         | **no existe** | existe           | `schema.ts` la modela y el código la usa                                                  |

**Diagnóstico:** `schema.ts` diverge de `migrations/` **y** de staging, en ambas direcciones. El baseline derivado de `schema.ts` **no es fiel** a la base real y se descartó.

#### Medición que reveló la brecha (baseline derivado de `schema.ts`)

| Categoría          | Staging | Baseline local |
| ------------------ | ------- | -------------- |
| Tablas             | 42      | 41             |
| Columnas           | 527     | 506            |
| Constraints        | 140     | 119            |
| Índices            | 211     | 210            |
| Políticas RLS      | 15      | 10             |
| Tablas con RLS     | **17**  | **7**          |
| Funciones `public` | 2       | 2 (distintas)  |
| Triggers `public`  | 1       | 0              |
| Valores de enum    | 137     | 139            |

**Faltaba en ese baseline:**

- Tablas: `activity_log`, `deletion_feedback`, `payment_chats`.
- Columnas: `activity_log` (10), `deletion_feedback` (9), `payment_chats` (7), `payments` (4: `shipped_at`, `verified_at`, `rejected_at`, `seller_status`), más 1 en `business_subscriptions`, `chat_sessions` y `payment_orders`.
- RLS en 10 tablas: `complaint_book_records`, `deletion_feedback`, `feedback_responses`, `feedback_tickets`, `import_jobs`, `import_rows`, `order_events`, `payment_chats`, `stock_movements`, `verification_otps`.
- Políticas: `feedback_tickets` (SELECT, INSERT) y `feedback_responses` (SELECT).
- Trigger `payments_order_number_immutable` y función `prevent_order_number_update()`.

**Sobraba en ese baseline:**

- Tablas `rate_limit_windows` y `webhook_events` (no existen en staging).
- Función `handle_new_user()` y su trigger sobre `auth.users`. Verificado contra el catálogo de staging: **no existe ningún trigger en `auth`**. La auto-creación de perfiles nunca estuvo desplegada; el perfil se crea desde la aplicación.
- Tipos enum `order_status` y `payment_method`, que ninguna tabla real usa (`payments.status` y `payments.payment_method` son `text`). Drift cosmético.

#### Resolución: baseline regenerado desde staging (2026-11-01)

Se adoptó **staging como fuente de verdad estructural**: es el único lugar donde existe la capa de seguridad realmente desplegada (17 tablas con RLS, 11 políticas, trigger de inmutabilidad de `order_number`). `schema.ts` aporta únicamente lo que el código actual necesita y staging todavía no tiene, y eso se aisló en `0002`.

Paridad verificada tras `supabase db reset`, comparando catálogo completo contra staging:

| Categoría          | Staging | Local reconstruido | Diferencias      |
| ------------------ | ------- | ------------------ | ---------------- |
| Tablas             | 42      | 44                 | +2 intencionales |
| Columnas           | 527     | 536                | +9 intencionales |
| Constraints        | 140     | 142                | +2 intencionales |
| Índices            | 211     | 218                | +7 intencionales |
| Políticas RLS      | 15      | 15                 | **0**            |
| Tablas con RLS     | 17      | 17                 | **0**            |
| Funciones `public` | 2       | 2                  | **0**            |
| Triggers `public`  | 1       | 1                  | **0**            |
| Valores de enum    | 137     | 137                | **0**            |
| Secuencias         | 1       | 1                  | **0**            |
| Vistas             | 0       | 0                  | **0**            |

Las 9 columnas, 2 constraints y 7 índices extra corresponden exactamente a `rate_limit_windows` y `webhook_events`. **Toda la estructura de staging está reproducida sin pérdida**, incluida la capa de seguridad completa.

**Hallazgo de seguridad (R12) — confirmado:** `src/core/payments/rateLimitShared.ts:74-78` **falla abierto** — ante cualquier error devuelve `allowed: true`. El catálogo de staging confirma que `rate_limit_windows` **no existe** allí, así que el rate limiting respaldado por base permite todo en ese entorno. `webhook_events` tampoco existe: la deduplicación de webhooks cae a un mecanismo en memoria (`webhookDedup.ts`), que no es compartido entre instancias.

**Alcance:** el defecto es de infraestructura, no de código. El código es correcto; el esquema que ejecuta no lo acompaña. Se corrige aplicando `0002` a staging antes de usarlo para validación de carga o seguridad; de lo contrario, cualquier prueba de rate limiting o de idempotencia de webhooks da un resultado falso.

**Bloqueo resuelto:** el dump se completó por introspección de catálogo desde el host (ruta IPv6 disponible), sin necesidad del pooler. El relay TCP IPv4→IPv6 funciona, pero Docker Desktop no enruta desde el contenedor hacia el host, así que `pg_dump` quedó descartado.

---

## 16. Riesgo de sobre-herramientaje

### 16.1 Estado actual

Store Lite usa hoy cinco herramientas, todas justificadas y ya integradas:

`Vitest` · `Playwright` · `GitHub Actions` · `Sentry` · `PostHog`

Eso es un stack de validación **sano**. No está sobrecargado.

### 16.2 El riesgo real

La propuesta consolidada sumaba siete herramientas: `k6`, `Semgrep`, `CodeQL`, `ZAP`, `TestSprite`, `OpenTelemetry` y el stack de `Grafana`. Adoptarlas todas convierte un stack sano en burocracia: suites que nadie mira, alertas que nadie atiende y mantenimiento sin dueño.

Tras aplicar el criterio de deduplicación quedó: **dos herramientas adoptadas** (`k6`, `CodeQL`) más la práctica de tests de tenancy, **una condicional** (`ZAP`, depende de staging) y **cuatro descartadas** (`Semgrep` por solapamiento con CodeQL, `TestSprite`, `OpenTelemetry` y el stack Grafana autogestionado).

**Criterio para aceptar una herramienta:** debe responder una pregunta concreta que hoy no tiene respuesta, y alguien debe ser responsable de leer su salida. Si falla cualquiera de las dos, es teatro.

### 16.3 Stack mínimo viable, por prioridad

| Tier                | Herramienta                  | Estado                  | Pregunta que responde                        | Costo     |
| ------------------- | ---------------------------- | ----------------------- | -------------------------------------------- | --------- |
| **0 — Bloqueante**  | Staging aislado              | ✅ Decidido             | ¿Dónde pruebo sin romper producción?         | Bajo      |
| **0 — Bloqueante**  | k6 `storefront-read`         | ✅ Decidido             | ¿Aguanta el tráfico anónimo real?            | Bajo      |
| **0 — Bloqueante**  | Tests de tenancy a mano      | ✅ Decidido             | ¿Puede un comerciante ver datos de otro?     | Medio     |
| **1 — Barato**      | CodeQL                       | ✅ Adoptado             | ¿Hay flujos de datos inseguros en el código? | Gratis    |
| **1 — Barato**      | Ampliar Playwright           | ✅ Decidido             | ¿Los flujos críticos siguen funcionando?     | Bajo      |
| **2 — Condicional** | OWASP ZAP Baseline           | ⏳ Pendiente de staging | ¿Hay superficie HTTP mal configurada?        | Medio     |
| **3 — Diferir**     | TestSprite                   | ❌ No adoptado          | ¿Necesito cobertura E2E generada por IA?     | Comercial |
| **3 — Diferir**     | OpenTelemetry                | ❌ No adoptado          | ¿Necesito trazas distribuidas?               | Alto      |
| **3 — Diferir**     | Stack Grafana autogestionado | ❌ No adoptado          | ¿Necesito centralizar telemetría propia?     | Muy alto  |

**Descartadas por solapamiento:** Semgrep (cubierta por CodeQL en >80%).

### 16.4 Respuesta directa

**No, el proyecto no está sobrecargado de herramientas hoy.** Está a un paso: el error sería adoptar las siete de golpe porque alguien las recomendó. El orden correcto es el de la tabla — y el Tier 3 probablemente nunca sea necesario para el tamaño actual de Store Lite.

La meta no es tener más herramientas. Es que cada nuevo grupo de comerciantes no sea una incógnita sobre el rendimiento de la aplicación.

---

## Anexo A - Comandos PowerShell (Fase 0)

### A.1 Verificar Docker

```powershell
docker info --format '{{.ServerVersion}}'
```

Si falla con `failed to connect to the docker API`, abrir Docker Desktop y esperar a que el daemon arranque.

### A.2 Inicializar Supabase local

```powershell
npx supabase init
npx supabase start
```

`supabase start` descarga imagenes y levanta Postgres, Auth, Storage y Studio en `http://127.0.0.1:54321`.

### A.3 Obtener credenciales locales

```powershell
npx supabase status
```

Copiar `API URL`, `anon key` y `DB URL` al `.env.local`. No imprimir ni pegar valores en el chat.

### A.4 Verificar que los entornos no se mezclan

Imprime solo el project ref (identificador publico), nunca el valor completo de una variable:

```powershell
Get-Content .env, .env.prod -ErrorAction SilentlyContinue |
  Select-String -Pattern 'NEXT_PUBLIC_SUPABASE_URL=https://([a-z0-9]+)\.supabase\.co' |
  ForEach-Object { $_.Matches[0].Groups[1].Value }
```

Los refs deben ser distintos. Si `.env` apunta a `127.0.0.1`, es correcto: usa Supabase local.

**Advertencia verificada (2026-10-31):** `vercel env pull` devuelve el literal `[SENSITIVE]` para variables marcadas como sensibles en Vercel. En este proyecto, `NEXT_PUBLIC_SUPABASE_URL` de **Production** está en ese estado, así que el ref de producción **no es comparable** desde el CLI. La comparación debe hacerse por dashboard o por el ref de la URL del proyecto.

**Refs confirmados:**

| Entorno           | Project ref            | Estado                                        |
| ----------------- | ---------------------- | --------------------------------------------- |
| Vercel Preview    | `likloeyrdzfsrwelpdoz` | ✅ Confirmado = proyecto dev (futuro staging) |
| Vercel Production | ilegible               | ⚠️ Marcado `SENSITIVE`                        |
| Local             | `127.0.0.1:54321`      | ✅ Stack propio                               |

### A.5 Detener el stack local

```powershell
npx supabase stop
```

### A.6 k6

```powershell
# Smoke local (requiere pnpm dev + pnpm db:seed)
k6 run tests/performance/k6/scenarios/smoke.js

# Lectura del storefront, perfil por defecto (smoke)
k6 run tests/performance/k6/scenarios/storefront-read.js

# Contra staging
$env:K6_BASE_URL = "https://<preview-url>.vercel.app"
$env:K6_PROFILE = "baseline"
k6 run tests/performance/k6/scenarios/storefront-read.js

# Guardar el resumen en JSON
k6 run --summary-export tests/performance/k6/results/storefront-read-baseline.json `
       tests/performance/k6/scenarios/storefront-read.js

# Dashboard web embebido
$env:K6_WEB_DASHBOARD = "true"
k6 run tests/performance/k6/scenarios/storefront-read.js
```

**Calentar antes de medir.** La primera petición a un servidor Next en frío compila la ruta y puede tardar decenas de segundos. Un `Invoke-WebRequest` previo contra la misma URL evita contaminar el percentil 95.

**Thresholds:** `K6_P95_MS` está desactivado a propósito. Se define recién después del primer baseline medido.

### A.7 CodeQL

No requiere comando. Se activa una sola vez en GitHub:

`Settings` -> `Code security` -> `CodeQL default setup` -> `Enable`.
