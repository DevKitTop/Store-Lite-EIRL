# YCloud — WhatsApp Business API para Store Lite

> Documento de trabajo / referencia central para la implementación de YCloud.
> Fecha de investigación: 2026-09-20 · Actualizado: 2026-09-23 (flujo Coexistence/QR implementado en código, activación por envs FB) · Próxima revisión: después del 2026-10-01 (cambio de pricing de Meta).

## 1. Resumen ejecutivo (TL;DR)

- **YCloud es un BSP oficial de Meta** (WhatsApp Business Solution Provider) con más de 200,000 clientes.
- **Para SaaS como Store Lite existe el _Tech Partner Free_: $0/mes, canales ilimitados, zero markup**. No usamos el plan "cliente final" (Free = 2 canales, Pro = $89 + $5/canal extra).
- **Meta cobra por mensaje entregado** (no por API). Tarifas Perú ~$0.02 service/utility/auth, ~$0.07 marketing.
- **Cambio crítico 2026-10-01**: _service messages_ y _utility templates en ventana 24h_ dejan de ser gratis. **1,000 service messages gratis por número/mes**. Desde Oct 2026 cada respuesta del seller cuesta ~$0.02 (menos la franquicia).
- **Economía real a 50 sellers**: $0 fijo plataforma + ~$1–1.5K/mes variable Meta (según uso). **No hay $299/mes de plataforma**.
- **Vinculación del seller = WhatsApp Business App Coexistence (QR)**: el seller escanea un QR con su app WhatsApp Business y listo — mismo número, mismos chats, mismo badge, sin registrarse en Business Manager. NO es obligatorio probar/activar hoy; es el flujo objetivo para el producto (ver §5.6).

**Conclusión**: el modelo "seller conecta su número y responde desde el SaaS" es viable y barato en fijo. La decisión clave es **cómo pasas el costo variable Meta al seller** (passthrough transparente vs plan premium incluido).

---

## 2. ¿Qué es YCloud?

- **Tipo**: BSP (Business Solution Provider) oficial de **Meta** para la WhatsApp Business Platform (API).
- **Ubicación**: apega a Meta; API REST `https://api.ycloud.com/v2` con `X-API-Key`.
- **Alternativas** (para comparar): Twilio, WATI, AiSensy, 360dialog, Zenvia, ChatDaddy (más orientado a LatAm/Perú), Kanal, Go4whatsup.
- Stack actual de Store Lite ya incluye **twilio** en `package.json` — ver comparativa en §7.

### Lo que te da YCloud (features del platform, incluidas en todos los planes)

- WhatsApp API (envío/recepción de mensajes)
- WhatsApp Templates (creación + aprobación de Meta)
- WhatsApp Campaign (broadcast/bulk)
- Chatbot Builder (no-code)
- WhatsApp Journeys (flujos)
- Contact Management (CRM de contactos)
- **Shared Team Inbox** (inbox compartido — útil si un seller tiene varios agentes)
- API & Webhooks
- Generative AI (créditos incluidos: 500K en Free, 100M en Enterprise)
- WhatsApp Calling
- WhatsApp Flows (formularios interactivos)

---

## 3. Pricing de YCloud — DOS TRACKS (clave para nosotros)

### 3.1 Tech Partner Program (nuestro track — SaaS que integra WhatsApp)

| Plan                  | Costo/mes | Canales        | Soporte                                               | Ideal para                        |
| --------------------- | --------- | -------------- | ----------------------------------------------------- | --------------------------------- |
| **Tech Partner Free** | **$0**    | **Ilimitados** | Self-onboarding + Ticket                              | **Store Lite** (integramos solos) |
| Tech Partner Service  | $300      | Ilimitados     | Dedicated manager, expert support, PLBV, co-marketing | Si necesitas ayuda hands-on       |

**Qué incluye Tech Partner Free**:

- Canales ilimitados → 1 seller = 1 canal = **$0 marginal**.
- Zero markup → pagas solo tarifa Meta oficial.
- **Embedded Signup** → el seller conecta su número **dentro de tu dashboard** sin salir a YCloud.
- Aplica a: "SaaS, CRM, ERP, CPaaS providers that want to integrate WhatsApp into their products".
- Registro: `https://ycloud.com/tech-partner` → "Apply to Become a YCloud Tech Partner".
- **Coexistence** (Meta, may 2025): para un número ya activo en la app WhatsApp Business, el flujo oficial de Embedded Signup ofrece **WhatsApp Business App Coexistence** — el seller escanea un QR y el número queda operando lado a lado en app y API. Es el camino preferido para sellers que ya usan la app (ver §5.6).

> ⚠️ **No confundir** con el plan "Free" de cliente final (abajo). Son programas distintos.

---

### 3.2 Pricing cliente final (referencia — NO es nuestro caso)

| Plan       | Precio                         | Incluye (relevante)                                                                                                           | Add-ons                    |
| ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Free**   | **$0 / forever** (sin tarjeta) | 1 usuario, **2 canales**, 500K créditos GenAI, 1K chars traducción, roles sistema, 6 meses storage chat, soporte email/online | —                          |
| **Pro**    | ~$89/mes                       | Planes superiores: más usuarios/canales, storage permanente, roles custom, soporte 24/7                                       | Usuario extra: **$10/mes** |
| Enterprise | ~$399/mes (billed anual)       | 40 usuarios, 30 canales, 100M créditos GenAI, 500K chars traducción, storage permanente                                       | Canal extra: **$5/mes**    |

Notas:

- **"Canal"** = 1 WhatsApp Business API account o 1 WhatsApp Business App account conectada a tu cuenta YCloud. **En nuestro SaaS, 1 seller conectado = 1 canal.**
- **Zero mark-up en mensajes**: YCloud solo pasa la tarifa de Meta, sin recargo. (Muchos BSPs cobran mark-up; YCloud es de los pocos que no.)
- Estructura de costos total = **tarifa Meta (por mensaje) + tarifa YCloud (plataforma)**. En Tech Partner Free: **plataforma = $0**.

---

## 4. Pricing de Meta (la parte que NO es gratis — lógica crítica)

Meta cobra **por mensaje entregado** (no enviado), según:

1. Categoría del mensaje (marketing / utility / authentication / service)
2. País del **receptor** (no del emisor)

### Categorías y su lógica para nosotros

| Categoría          | ¿Cuándo aplica?                                                                | Costo aprox. Perú (USD/msg) | Nota                                                       |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------- | ---------------------------------------------------------- |
| **Service**        | Respuesta libre (sin template) dentro de ventana 24 h tras mensaje del cliente | ~0.02 (desde Oct 1 2026)    | **1,000 gratis por número/mes**; antes de Oct gratis total |
| **Utility**        | Template transaccional: confirmación de pedido, tracking, pagos, recordatorios | ~0.02                       | Aplica volume tier (hasta −20%)                            |
| **Authentication** | Template OTP / login / verificación                                            | ~0.02                       | Aplica volume tier                                         |
| **Marketing**      | Template promocional: ofertas, cupones, reactivación                           | **~0.07**                   | El más caro; NO aplica volume tier (aún)                   |

### Cambios 2026 (IMPORTANTE para el roadmap)

- **Oct 1, 2026**: _service messages_ y _utility templates dentro de ventana 24 h_ pasan de gratis a **cobrados por mensaje**. Cada número de teléfono tiene **1,000 service messages gratis al mes** (no acumulable).
- **72-hour free entry point**: conversaciones iniciadas por Click-to-WhatsApp ad o botón de Facebook Page → todos los mensajes gratis por 72 h.
- **Meta Business Agent (IA de Meta)** desde Ago 2026: se cobra por token (~$2 por millón de tokens ≈ 4–5 cts por respuesta IA). Relevante solo si usamos IA de Meta; podemos ignorarlo con YCloud.
- **No aplica al WhatsApp Business App** (app gratis) — solo a la API.

### Costo realista para Store Lite (escenario típico seller, **Tech Partner Free**)

- **Plataforma YCloud: $0 fijo** (canales ilimitados).
- Seller con ~300 clientes/mes, 1,500 respuestas service → 500 billables × $0.02 = **~$10/mes solo tarifas Meta** (menos 1,000 gratis por número = aún menos).
- 50 sellers activos ≈ **$0 fijo + ~$1–1.5K/mes variable Meta** (según volumen real).
- Marketing (~$0.07/msg) sigue caro — no para MVP.

> **El $5/canal y $299/mes Pro ya no aplican** para nosotros. Ese era el track "cliente final".

---

## 5. Lógica de integración para Store Lite (multi-tenant)

### 5.1 Modelo conceptual

```
┌─────────────┐   inbound (cliente escribe)   ┌──────────────┐
│  Cliente    │ ────────────────────────────▶ │  YCloud (BSP)│
│ (WhatsApp)  │ ◀──────────────────────────── │              │
└─────────────┘   outbound (seller responde)  └──────┬───────┘
                                                     │ webhook (inbound/status)
                                                     ▼
                                    ┌────────────────────────────────┐
                                    │        Store Lite API          │
                                    │  - Enrutamiento channel→seller  │
                                    │  - Persistencia conversaciones  │
                                    │  - Auth seller + UI de chat     │
                                    └────────────────────────────────┘
```

**Regla de oro del modelo**: 1 seller conecta SU número de WhatsApp = 1 channel YCloud = 1 WABA. Store Lite actúa como **tenant manager**: enruta eventos de cada channel al seller correcto y envía mensajes usando el channel de ese seller.

### 5.2 Flujo INBOUND (cliente → seller) — el core de la feature

1. Cliente escribe al número de WhatsApp del seller.
2. YCloud dispara webhook `whatsapp.inbound_message.received` a nuestro endpoint.
3. Store Lite:
   a. Verifica firma `YCloud-Signature` (HMAC-SHA256).
   b. Identifica el `phoneNumberId`/`wabaId` → lo mapea al seller (tabla de channels).
   c. Persiste el mensaje en `whatsapp_messages` y crea/actualiza `whatsapp_conversations`.
   d. Notifica al seller (UI en tiempo real / notificación).
4. Seller abre el chat dentro del dashboard y responde.
5. Store Lite llama `POST /v2/whatsapp/messages/sendDirectly` con `from` = channel del seller.
6. YCloud entrega; llega webhook `whatsapp.message.updated` (sent/delivered/read/failed) → actualizamos estado.

### 5.3 Flujo OUTBOUND proactivo (seller → cliente sin que el cliente escriba primero)

- Fuera de la ventana de 24 h **solo se pueden mandar templates aprobados por Meta** (utility/marketing/auth).
- Para pedidos: templates utility (ej: "Tu pedido #X ha sido enviado") — más baratos que marketing.
- Store Lite debe gestionar el **ciclo de vida de templates**: crear via API → esperar `whatsapp.template.reviewed` → usar.
- Las 72 h free (click-to-WhatsApp) solo aplican si el cliente llegó por anuncios.

### 5.4 Esquema de datos sugerido (Drizzle/Supabase — a validar)

```ts
// whatsapp_channels
- id, seller_id (FK), ycloud_phone_number_id (unique), waba_id,
  display_phone_number, is_active, connected_at, created_at

// whatsapp_conversations
- id, channel_id (FK), customer_phone, last_message_at, status,
  meta_bsu_id (business-scoped user id — clave para dedupe de cliente),
  created_at, updated_at

// whatsapp_messages
- id, conversation_id (FK), channel_id (FK), direction ('inbound'|'outbound'),
  type ('text'|'template'|'media'|'interactive'), template_name?, body,
  ycloud_message_id (unique), status ('accepted'|'sent'|'delivered'|'read'|'failed'),
  meta_price?, created_at

// whatsapp_templates
- id, channel_id (FK) o global, name, category, language, body,
  meta_status ('pending'|'approved'|'rejected'), created_at
```

### 5.5 Decisiones de negocio pendientes (para definir en planning)

1. **¿Quién paga el costo de Meta (variable por uso)?**
   - Opción A (recomendada): passthrough al seller — Store Lite le cobra el costo real de sus mensajes (transparente, facturación mensual) o un plan premium que lo incluya con margen.
   - Opción B: Store Lite absorbe (malo a escala — el costo crece con cada seller y uso).
2. **¿Plan YCloud?** → **Tech Partner Free** (canales ilimitados, $0 fijo, Embedded Signup). Nos registramos como Tech Partner; la cuenta YCloud es de Store Lite, cada seller = 1 canal. **Decidido y verificado con API real**: conectamos el número +51 967 356 665 (WABA 1402783271932218, estado CONNECTED, TIER_250). El flujo de vinculación del seller es Coexistence (QR) — ver §5.6. No usamos el plan "cliente final" (Free = 2 canales, Pro = $89 — contrario a nuestro modelo multi-seller).
3. **¿Mensajes outbound tipo marketing?** → Los cobramos aparte (premium) o los desactivamos en MVP.
4. **¿Reutilizar Twilio (ya instalado)?** → Ver §7.
5. **¿Camino de onboarding del seller?** → **WhatsApp Business App Coexistence** como flujo principal (seller ya usa la app → escanea QR → listo). Embedded Signup clásico (crear número nuevo en WABA de Store Lite) queda como alternativa para sellers sin app Business. **Requisito de producto**: el seller NUNCA sale de Store Lite; "solo se acepta WhatsApp Business App, no WhatsApp personal" se comunica en el UI del onboarding.
6. **¿Catálogo de WhatsApp?** → **EXCLUIDO del alcance actual (decisión 2026-09-22)**. El catálogo de WhatsApp es un canal de exhibición, no de venta estructurada: los "pedidos" que genera son mensajes de texto (ya cubiertos por el motor de chat); no hay pedidos estructurados vía API; WhatsApp Pay no aplica en Perú. La dirección Store Lite → Meta Catalog requiere Commerce Manager + compartir catálogo con el BSP (setup alto para el seller). **Si se implementa algún día (P2, opcional)**: import one-shot "Importar catálogo de WhatsApp" con **fuente de verdad = Store Lite, SIN sync bidireccional** (regla de oro: nunca dos fuentes de verdad). El modelo desacoplado ya existe en `whatsapp_channels` — solo faltaría `catalog_id`. Los productos de WhatsApp traen data mínima (foto, nombre, precio, descripción, código) → mapping manual al importar.

### 5.6 Onboarding del número del seller — WhatsApp Business App Coexistence (flujo principal)

**Contexto**: los sellers de Store Lite ya usan WhatsApp (generalmente la app WhatsApp Business porque son comercios). Para ellos, el flujo ideal NO es crear un WABA nuevo y registrar un número desde cero (fricción, requiere una cuenta de negocio en Meta). Meta introdujo (May 6, 2025) **WhatsApp Business App Coexistence**: un número que ya vive en la app Business App puede conectarse a la Cloud API **conservando el número, el historial de chats, el badge azul y la app móvil**. YCloud lo soporta nativamente (card "Connect WhatsApp Business App" en la consola). **Este es el flujo objetivo para el producto**.

> ⚠️ **NO es como WhatsApp Web/Desktop**: ahí el celular es el dueño y si se apaga se corta (es un espejo). En Coexistence el QR es solo el "apretón de manos" inicial (una vez); el número queda **activo en la Cloud API aunque el celular esté apagado**, el seller responde desde el dashboard de Store Lite, con historial sincronizado si elige "share chats".

**Requisitos (comunicar al seller en el onboarding):**

- Usar **WhatsApp Business App** (gratis, disponible en Play Store / App Store), versión 2.24.17 o superior. **NO aplica WhatsApp personal** (la app Business estándar no es elegible).
- Migración dentro de la app: Ajustes → Cuenta web/WhatsApp → "Migrar a WhatsApp Business" conserva chats y badge (permite pasar de la app personal a Business sin perder nada).
- El seller NO necesita registrarse en Meta Business Manager ni crear un WABA: **Meta crea automáticamente un WABA de coexistencia** por número conectado (máx. **4 WABAs de coexistencia por business portfolio** — límite de Meta; para un seller con 1 número no es problema).
- El número solo puede estar activo en **un BSP a la vez** (regla de siempre; YCloud ya es el BSP de Store Lite).

**Flujo (dentro de Store Lite, el seller nunca sale del dashboard):**

1. Seller abre "Conectar WhatsApp" en Store Lite → nuestra API crea una sesión de Embedded Signup (endpoint de integración, aún por implementar) y abre un **popup embebido de Meta** (Embedded Signup), no un redirect.
2. Dentro del popup, el seller elige **"Connect WhatsApp Business App"** y selecciona su número.
3. Meta muestra un **código QR** → el seller lo escanea con su celular (WhatsApp Business App).
4. Al escanear (o tras aprobar autorización), el número queda conectado: mismo número, mismos chats, mismo badge. YCloud dispara el webhook `whatsapp.phone_number.updated` / `whatsapp.smb.app.state.sync` (si el seller eligió "Share Chats").
5. Store Lite adopta el channel: el webhook crea/actualiza `whatsapp_channels` con el `phoneNumberId` del número (o la app hace polling del estado al reabrir). A partir de ahí, el motor de chat funciona igual que hoy.

> **Alternativa (Embedded Signup clásico)**: solo para sellers SIN app WhatsApp Business — crea un número nuevo / WABA en la cuenta Store Lite (requiere registro en Meta dentro del popup). Mantenemos la decisión de producto: el flujo Coexistence es el camino para >95% de los sellers.

**Decisiones de producto (vigentes):**

- **NO se relinkea a diario**: la conexión es una sola vez. Única condición de permanencia: el seller debe **abrir la app Business al menos 1 vez cada 14 días** (si no, Meta puede desactivar el sync; avisar en el onboarding, no es motivo de re-vinculación diaria).
- **Solo WhatsApp Business App** se informa proactivamente en el UI de onboarding (no pedir a nadie con WhatsApp personal sin avisar la migración).
- **El flujo Coexistence (QR) ESTÁ implementado en el código** (cambio SDD `whatsapp-coexistence`, slices 1–5): `WhatsAppCoexistenceModal` abre el popup de Meta vía `FB.login` (`useFbEmbeddedSignup`), el evento `FINISH` postea a `/connect/complete` (bind `smb/bind`), y el `connect/status` polling + webhook `whatsapp.phone_number.updated` / `smb.app.state.sync` llevan el canal a `connected`. **Cada seller vincula SU número de WhatsApp Business con su propio QR** — nunca el número de la cuenta de Store Lite.
- **Activación**: el popup coex se enciende SOLO cuando `.env` tiene las 3 variables públicas de Meta: `NEXT_PUBLIC_YCLOUD_FB_APP_ID`, `NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID`, `NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID` (verificado en `ChatClient.handleOpenWhatsAppConnect` y `env.ts`).
- **Fallback dev (NO es el flujo del producto)**: sin esas envs, la app cae al flujo legacy "detect-and-adopt" (`connect/init`): adopta el número CONNECTED de la cuenta YCloud de Store Lite (+51 967 356 665) sin modal. Es el comportamiento P0/piloto, y **explica** por qué el canal reaparece solo al borrarlo o por qué se ve "No hay conversaciones" (channel activo sin conversaciones).
- **Estado real por cerrar**: implementación lista y testeada (suite + type-check + lint verdes). Pendiente: (1) colocar las 3 envs FB en `.env` (y en el ambiente de producción), (2) E2E manual en vivo del popup de Meta con credenciales reales (task 5.4), (3) migración 0048 aplicada (ADD COLUMN `connection_status` — hoy ya aplicada en dev a mano vía SQL).

**Cómo obtener las 3 vars** (fuente: YCloud Partner Center — "Embedded Signup" + "Technical Development Partner Onboarding", 2026-09-23):

| Var                                 | De dónde                              | Pasos                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_YCLOUD_FB_APP_ID`      | Tu Meta Developer Business app        | `developers.facebook.com` → crear **Business app** con use case "Connect with customers through WhatsApp" → `App Settings > Basic` te da el App ID                                                                                                                                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID`   | Facebook Login for Business en tu app | Dashboard de la app → **Facebook Login for Business > Configurations > Create from template** → **"WhatsApp Embedded Signup Configuration With 60 Expiration Token"** → copiar Configuration ID                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID` | Lo entrega YCloud                     | ① Aplicar en `ycloud.com/tech-partner` (respuesta ~1 día hábil) ② Registrarse en YCloud y avisar al equipo (te dan permisos Tech Partner) ③ Ser Meta Tech Provider: Business Portfolio + registro Meta Developer + crear la Business app + onboarding "Become a Tech Provider" → elegir **"Working with a Solution Partner"** ④ En YCloud: **Create a partner solution** (nombre = tu empresa, YCloud App ID `2892949377516980`, "Send messages and make calls → Only my partner") → **YCloud aprueba y te manda el Solution ID** por email/BM |

**Configuración obligatoria en Meta (antes de probar el popup):**

- **Facebook Login for Business > Settings > Client OAuth settings**: poner en **Yes** → Client OAuth Login, Web OAuth Login, Enforce HTTPS, Embedded Browser OAuth Login, Use Strict Mode for redirect URIs, Login with the JavaScript SDK.
- **Allowed Domains + Valid OAuth Redirect URIs**: agregar TODOS los dominios donde corre la app (incl. dev/test). ⚠️ **Solo HTTPS** → para probar en local dev hace falta un dominio HTTPS real (túnel tipo ngrok o dominio de deploy), no localhost.
- **Dev vs Live**: en modo **Development** el popup muestra "App not active" salvo que el usuario esté agregado como **test user** en la app. Para producción real: **App Review** (2 videos: enviar mensaje desde la app + crear template) + **Access Verification** + modo **Live**. Hasta que el solutionID esté bien configurado, el seller NO verá el nombre del Solution Partner en la autorización de Facebook.
- **Tiempo estimado**: ~$0 plataforma; 1–2 días hábiles de trámite YCloud + 1–3 h de config en Meta + videos de App Review. Sin cambios de código (el flujo ya está implementado).

**Hallazgo clave (2026-09-23, guía Tech Provider de Twilio — mismo programa Meta):**

- **NO existe un solutionID de prueba/desarrollo** — el `solutionID` ES la Partner Solution; solo se genera cuando **YCloud crea la Partner Solution para tu app y vos la aceptás** (`WhatsApp > Partner Solutions` en el dashboard de tu app). No hay atajo, es la última pieza.
- **La app debe estar en modo LIVE (publicada) para que el proveedor cree la Partner Solution** (textual Twilio: "Your app must be Live (published) for [the provider] to create the Partner Solution"; se puede volver a Development después). O sea: **YCloud está frenado por tu checklist de Meta**, no al revés.
- **Meta bloquea el onboarding hasta aprobar advanced access (App Review)** ("You will not be able to onboard business customers until your app has been approved for advanced access"). Permisos a pedir: `whatsapp_business_management` + `whatsapp_business_messaging`.
- **Timelines reales (Meta)**: Access Verification ~**5 días hábiles**; business verification puede tomar **semanas** → iniciar temprano.
- **Testing temprano**: en modo Development con roles admin/developer/tester se puede probar el flujo Embedded Signup (la doc oficial de Meta dice "you should be able to test the flow by simulating a business customer while using your own Meta credentials"). Recomendación Twilio para testing: crear un **business portfolio de test aparte** ("MyCompany Test") porque Meta NO permite elegir dentro del flujo el portfolio que se usó para crear la app.

---

## 6. Detalles técnicos clave de la API YCloud

| Área      | Detalle                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL  | `https://api.ycloud.com/v2` — auth con header `X-API-Key`                                                                                                                                                                                                                                                                                                                                                                                      |
| Mensajes  | `POST /whatsapp/messages/sendDirectly` (inmediato) · `POST /whatsapp/messages` (cola)                                                                                                                                                                                                                                                                                                                                                          |
| Templates | CRUD `/whatsapp/templates`; creación vía API; aprobación de Meta llega por webhook                                                                                                                                                                                                                                                                                                                                                             |
| Números   | `GET /whatsapp/phoneNumbers` (listado) · `GET /whatsapp/phoneNumbers/{wabaId}/{phoneNumber}` (detalle; E.164 urlencoded, ej. `%2B51967356665`) · `POST /whatsapp/phoneNumbers/{wabaId}/{phoneNumber}/register` (registrar número ya agregado al WABA). ⚠️ NO existe `POST /whatsapp/phoneNumbers/register` plano — fue el bug de la primera implementación (404), corregido en `connect/init` y `connect/status` (usan listado + match por id) |
| Webhooks  | CRUD `/webhookEndpoints` (también por dashboard → Developers > Webhooks)                                                                                                                                                                                                                                                                                                                                                                       |
| SDKs      | Oficiales (Java, etc.); docs en `https://docs.ycloud.com/llms.txt` (útil para futuras sesiones)                                                                                                                                                                                                                                                                                                                                                |

**Webhooks esenciales a suscribir:**

- `whatsapp.inbound_message.received` (cliente escribió)
- `whatsapp.message.updated` (estado de mensaje saliente: sent/delivered/read/failed + `totalPrice`)
- `whatsapp.template.reviewed` (template aprobado/rechazado)
- `whatsapp.phone_number.updated` (estado del canal)
- `whatsapp.smb.app.state.sync` (coexistencia: estado del sync cuando el seller conecta su app Business vía QR y elige "Share Chats")

**Firma de webhook (obligatorio implementar):**

```
Header: YCloud-Signature: t={timestamp},s={signature}
signed_payload = "{timestamp}.{request_body}"
signature = HMAC-SHA256(signed_payload, secret)
```

**Reglas de webhook:**

- Responder 2xx (< 6 s recomendado; procesar en background).
- Retry automático: 10s → 30s → 5m → 30m → 1h → 2h → 2h (máx 7 intentos).
- URL suspendida tras 200 fallos/min (3 min de suspensión) → necesitamos endpoint robusto + idempotencia.

**Rate limits / errores**: mensajes fallidos llegan con `errorCode` + `whatsappApiError` de Meta. Modelar `status='failed'` y alertar al seller.

---

## 7. YCloud vs Twilio (ya tenemos twilio en el stack)

| Criterio                            | YCloud                             | Twilio                        |
| ----------------------------------- | ---------------------------------- | ----------------------------- |
| Mark-up sobre tarifa Meta           | **0 (zero mark-up)**               | Cobra mark-up (varía)         |
| Plan free                           | **Sí ($0 forever, sin tarjeta)**   | Sandbox limitado              |
| Cantidad de canales (multi-tenant)  | Simple: canales adicionales $5/mes | Por número, más caro          |
| Template management (UI + revisión) | Incluido (dashboard + API)         | Manual vía Meta               |
| UI de soporte (chatbot, inbox)      | Incluida                           | No (solo API)                 |
| Foco                                | WhatsApp-first                     | Genérico (SMS/voice/whatsapp) |

**Veredicto**: para WhatsApp-first multi-tenant, **YCloud es superior y más barato**. Twilio queda SOLO para **OTP Verify (SMS)** en verificación de teléfono del seller — `sendOtpWhatsApp` está deprecado y `sendOrderStatusSms` usa JSONpe. No duplicar WhatsApp en ambos (auditado y decidido: mantener Twilio solo para OTP).

---

## 8. Riesgos y gotchas

1. **"Free" es free de plataforma, no de mensajes** — presupuestar tarifas Meta desde el día 1 (buena noticia: 1,000 service/mes gratis por número).
2. **Cambio Oct 1, 2026**: service messages pasan a cobrarse — afecta directamente el caso de uso "seller responde". Revisar tarifas publicadas por Meta (se publicaron Sep 1, 2026).
3. **Marketing caro en Perú** (~$0.07/msg) — NO usar broadcast marketing como feature inicial.
4. **1 número = 1 BSP** — el seller no puede tener el mismo número en YCloud y otro proveedor. Manejar expectativas en onboarding.
5. **Plantillas**: los mensajes proactivos fuera de ventana 24 h REQUIEREN template aprobado. Content review de Meta puede tardar y rechazar.
6. **Firma webhook**: sin validarla, cualquiera puede inyectar mensajes falsos → spam/robo de credenciales.
7. **Idempotencia**: procesar webhooks con store-and-forward (validar `id` de evento antes de persistir).
8. **Regulación Perú**: WhatsApp no está regulado como canal de pago, pero los mensajes comerciales deben respetar consentimiento (ver `docs/compliance/14-USER-CONSENT.md`).
9. **Alcance del plan**: nosotros usamos **Tech Partner Free** (canales ilimitados) — la tabla "cliente final" (2 canales, 6 meses storage) NO aplica a nuestro track; se mantiene solo como referencia en §3.2.
10. **Números virtuales**: si un seller no tiene número WhatsApp Business, el flujo Coexistence no aplica (no hay app que escanear) → cae al Embedded Signup clásico o al flujo manual de consola. No es el caso típico (los sellers de Store Lite ya usan WhatsApp).
11. **Coexistence gotchas específicos**: (a) la app Business debe abrirse ≥1 vez/14 días o el sync puede desactivarse; (b) máx 4 WABAs de coexistencia por business portfolio (1 número = 1 WABA coexist); (c) throughput limitado a ~5–20 msg/s por número (sobra para SMB); (d) al escanear el QR, el seller puede elegir "no compartir historial" — en ese caso el webhook `whatsapp.smb.app.state.sync` no traerá contactos previos; (e) ciertos países están restringidos para coexistencia (revisar listado oficial de Meta por mercado) — Perú no está restringido y la consola YCloud de Store Lite ya muestra la card de coex.

---

## 9. Roadmap sugerido (MVP → escala)

| Fase                                        | Alcance                                                                                                                                                                                                                                             | Costo estimado (Tech Partner Free)                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **P0 · Piloto**                             | 1–5 sellers piloto. Inbound: cliente escribe → chat en dashboard → seller responde. Conectar número via **Coexistence (QR)** cuando aplique; detect-and-adopt para el número actual. Sin templates outbound.                                        | **$0 plataforma** + tarifas Meta (~$10–50/mes total piloto) |
| **P1 · Conversaciones + templates utility** | Multi-seller (canales ilimitados gratis), flujo Coexistence completo (sesión Embedded Signup + popup + polling), notificaciones de pedidos/estado vía templates utility, estados de mensaje en UI, alertas, facturación passthrough Meta al seller. | **$0 plataforma fija** + variable Meta + tu margen          |
| **P2 · Premium**                            | Chatbot/IA (créditos GenAI de YCloud), broadcast marketing (cobrado), WhatsApp Flows, Analytics, plan premium "WhatsApp incluido" por seller.                                                                                                       | Incluido en planes superiores / tu pricing                  |

---

## 10. Fuentes y referencias

- YCloud Tech Partner Program: https://ycloud.com/tech-partner (Free: $0, canales ilimitados, Embedded Signup)
- YCloud pricing (cliente final): https://ycloud.com/pricing
- YCloud whatsapp-business-api (FAQ "Is WhatsApp API free?"): https://www.ycloud.com/whatsapp-business-api
- YCloud docs (API ref + webhooks): https://docs.ycloud.com/reference/webhook-integration-guide · `https://docs.ycloud.com/llms.txt`
- YCloud blog — Oct 1 2026 pricing (service messages): https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026
- YCloud help center — Coexistence / conectar app Business: https://helpdocs.ycloud.com/help-center/whatsapp-accounts-management/create-a-whatsapp-api-account (card "WhatsApp Business APP Coexistence")
- YCloud Partner Center — Embedded Signup (guía vars FB): https://helpdocs.ycloud.com/partner-center/english-en-2/ji-shu-kai-fa-huo-ban/embedded-signup.md
- YCloud Partner Center — Technical Development Partner Onboarding (ser Tech Provider + Partner Solution → Solution ID): https://helpdocs.ycloud.com/partner-center/english-en-2/ji-shu-kai-fa-huo-ban/ji-shu-kai-fa-huo-ban-ru-men.md
- YCloud blog — Coexistence update (may 2025): https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update
- Meta — WhatsApp Business App Coexistence / Embedded Signup: https://developers.facebook.com/docs/whatsapp/embedded-signup/coexistence · límite 4 WABA coexist por portfolio
- Meta — WhatsApp pricing por mercado/categoría: https://whatsappbusiness.com/products/platform-pricing (incluye PEN)
- Tarifas referencia Perú 2026 (verificar contra rate card de Meta): wuaps.com (marketing $0.0703, utility/auth $0.02) · ChatDaddy (FAQ Perú)

> ⚠️ Las tarifas de Meta cambian; **siempre verificar el rate card oficial** antes de fijar precios al seller. Próxima verificación recomendada: después del 2026-10-01.
