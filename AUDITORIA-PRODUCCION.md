# AuditorÃ­a de ProducciÃ³n â€” Store Lite

> **DOCUMENTO SUPERADO (SUPERSEDED) — NO usar como estado actual.**
>
> Este es el audit original (contenido 24/09–02/10/2026). Su estado por hallazgo
> quedó desactualizado: varias fichas marcadas como abiertas ya fueron
> remediadas, y otras migraron a hallazgos nuevos.
>
> **Fuente de verdad actual:** `docs/PREPRODUCTION_READINESS_2026-10_VERIFICATION.md`
> (ver la sección "Current status" al inicio, que supersede las tablas de rondas
> anteriores).
>
> Se conserva como registro histórico del audit inicial.
>
> Nota: este archivo tiene mojibake en los acentos (doble-encoding UTF-8/Latin-1),
> p. ej. "AuditorÃ­a". Se preserva tal cual para no alterar el registro histórico.

> **Proyecto:** Store Lite (multi-tenant SaaS de tiendas)
> **Fecha auditorÃ­a:** 24/09/2026
> **MÃ©todo:** 5 agentes de auditorÃ­a read-only en paralelo (auth/sesiones, checkout/Culqi, panel/admin, WhatsApp/YCloud, infra/datos/observabilidad) + verificaciÃ³n manual de claims.
> **Estado general:** âŒ NO listo para beta pÃºblica â€” **11 hallazgos CRITICAL** pendientes.
> **Ãšltima actualizaciÃ³n:** 02/10/2026 â€” C11 y C10 re-verificados contra el cÃ³digo: ambos **rancios**. C11 por eliminaciÃ³n de su funciÃ³n (`f0efd09`); C10 porque su fix ya se aplicÃ³ (`5ce5c1f7`) y sÃ³lo queda el residual atado a C1. El riesgo de C11 **migrÃ³** a dos superficies vivas, una de ellas (`order/verify/[orderNumber]`) reescalada de Grupo 2 a Grupo 1 CRITICAL. W-A1 reescalado a Grupo 1: el fix de C4 **invirtiÃ³** su premisa. W-A2 confirmado vivo. Hallazgo nuevo W-N1.

---

## 1. Resumen ejecutivo

- El proyecto compila, pasa lint y la suite unitaria es fuerte (1994 tests). **Pero eso no es producciÃ³n.**
- Un audit externo previo concluyÃ³ "no listo" con evidencia desactualizada (build roto, 5 lint errors, 6 TS errors). Verificado manualmente: **build pasa (EXIT 0), lint pasa (0 errores)**, y los errores de `tsc` estÃ¡n solo en `.next/dev/types/routes.d.ts` (archivo **generado y corrupto**, no cÃ³digo fuente â€” se arregla borrando `.next`). Su conclusiÃ³n final, sin embargo, resultÃ³ correcta por razones mÃ¡s serias.
- Los 11 CRITICAL reales son de **capa de confianza y control de acceso** (RLS, verificaciÃ³n de pagos, auth en endpoints, ownership en server actions, secretos en git history, migraciones no reproducibles).
- La mayorÃ­a son fixes server-side acotados. No es semanas de trabajo, pero **ninguno se puede saltear** para abrir a usuarios reales.

| MÃ³dulo | Riesgo | Veredicto |
|--------|--------|-----------|
| Auth & sesiones | 5/5 | NOT READY |
| Checkout & pagos (Culqi) | 5/5 | NOT READY |
| Panel & admin | 5/5 | NOT READY |
| Infra / datos / observabilidad | 4/5 | CONDITIONAL |
| WhatsApp & YCloud | 2/5 | CONDITIONAL (mejor mÃ³dulo) |

---

## 2. CRITICAL â€” Top blockers (orden de prioridad)

### C1. Base de datos abierta: sin RLS + anon key en el bundle
- **MÃ³dulos:** Auth (F1) + Payments (C2)
- **Evidencia:** solo `storage.objects`, `profiles`, `business_team_roles`, `business_invitations`, `business_team_members`, `join_attempt_rate_limit`, `notifications`, `feedback_tickets`, `feedback_responses` tienen `ENABLE ROW LEVEL SECURITY` en migraciones. Cero `GRANT`/`REVOKE` en todo el repo. `payments`, `payment_orders`, `payment_idempotency_keys`, `chat_sessions`, `messages`, `businesses` **sin RLS**. La anon key viaja en el bundle (`src/lib/supabase/client.ts`).
- **Impacto:** cualquier persona puede leer TODA la tabla de pagos (DNI, mail, telÃ©fono, direcciÃ³n, importes), el libro de ventas, y los chats vÃ­a PostgREST con la anon key pÃºblica.
- **Fix:** habilitar RLS + policies owner/seller/buyer en esas tablas. **Primero confirmar estado LIVE** (si el dashboard de Supabase tiene RLS activo pero las migraciones no, hay drift).
- **Prioridad:** 1

### C2. Exploit de orden gratis â€” `/api/payment/charge` marca `paid` sin verificar Culqi
- **MÃ³dulo:** Checkout & pagos (C1)
- **Evidencia:** `app/api/payment/charge/route.ts:277-279` â€” cuando el cliente manda `culqiOrderId` sin token, el server asume que Culqi ya cobrÃ³ y crea el payment `paid` sin ninguna verificaciÃ³n. `:372` inserta `payments.status='paid'`, `:393-398` marca `payment_orders` pagada, `:404-409` descuenta stock. **Cero** llamadas GET a `api.culqi.com/v2/orders/...` en todo el repo.
- **Impacto:** POST sin autenticaciÃ³n con un `culqiOrderId` inventado â†’ orden pagada, stock consumido, vendedor notificado, **plata no recibida**. El rate limiter in-memory (3/30s por business:product) solo frena el batch.
- **Fix:** validar server-side el estado real de la orden en Culqi (GET `/v2/orders/{id}`) antes de insertar `paid`, o gatillar la transiciÃ³n solo vÃ­a webhook `order.status.changed`.
- **Prioridad:** 2

### C3. Secuestro de cuenta vÃ­a OAuth â€” origin sin validar en `/auth/customer`
- **MÃ³dulo:** Auth (F3)
- **Evidencia:** `app/auth/customer/page.tsx`: `storeOrigin = searchParams.get('origin')` usado directo como target de `postMessage` para `access_token`/`refresh_token`. El lado receptor (`OrderAuthGate.tsx:219`) sÃ­ valida `event.origin === AUTH_ORIGIN`; el lado emisor no.
- **Impacto:** `https://store/auth/customer?origin=https://evil.com` â†’ el usuario se loguea con Google â†’ los tokens de Supabase se postean a evil.com â†’ **toma de cuenta total**.
- **Fix:** validar `origin` contra allowlist (same-origin o lista de dominios) antes del `postMessage`.
- **Prioridad:** 3

### C4. La pÃ¡gina de orden filtra todo el PII a cualquiera con el link
- **MÃ³dulo:** Auth (F4)
- **Evidencia:** `order/[token]/page.tsx` (server component) renderiza incondicionalmente `buyerEmail`/`buyerPhone`/`buyerDni` (L1541-1555), direcciÃ³n completa con agencia y referencia (L1470-1496), `pickupCode` (L1512), `ticketImageUrl`, metadata de identidad Google (L1561-1630). `OrderAuthGate.tsx` solo gating client-side con marker en localStorage que verifica **Ãºnicamente `expiresAt`** (forgeable). Auto-auth `?dni=` (L181-207) llama `verifyOrderAccess(token, dni)` sin orderNumber; `actions.ts:177-181`: `null !== null` es falsy â†’ con `orderNumber IS NULL`, **un DNI pelado desbloquea la orden**.
- **Impacto:** cualquiera con el tracking link (que vive en URLs â†’ referer/history) ve todos los datos del comprador y puede forjar acceso.
- **Fix:** mover los datos sensibles detrÃ¡s de verificaciÃ³n server-side (cookie o token HMAC ligado a DNI/authId), no a RSC abierta. Arreglar el bug del `orderNumber IS NULL`.
- **Prioridad:** 4

### C5. `/api/ticket/generate` sin autenticaciÃ³n, escribiendo con service-role
- **MÃ³dulo:** Panel (C1)
- **Evidencia:** `app/api/ticket/generate/route.ts:44-259` â€” sin auth en el POST. Quien conozca un `orderNumber` (semi-pÃºblico, en recibos) obtiene el ticket completo (DNI, mail, direcciÃ³n del comprador + RUC/direcciÃ³n del negocio) y `forceRegenerate: true` sobrescribe tickets de cualquier tenant usando el **cliente service-role** (route.ts:18-22, 233-238).
- **Fix:** `requireOwnedBusinessById(payment.businessId)` + membresÃ­a antes de leer/regenerar; rate limit.
- **Prioridad:** 5

### C6. Server actions del panel sin verificar quiÃ©n llama (cross-tenant)
- **MÃ³dulo:** Panel (C2)
- **Evidencia:** `src/features/dashboard/actions/ticketActions.ts` y `finalizationActions.ts` â€” `uploadTicketAndUpdatePayment`, `notifyDelivery`, `prepareOrder`, `markReadyForPickup`, `requestFinalization`, `confirmPickedUp` verifican `payment.businessId === businessId` del cliente pero **nunca** que el caller sea dueÃ±o/miembro de ese negocio. `getAuthenticatedUserId()` devuelve `null` en fallo de auth y la acciÃ³n **continÃºa** con `actorId: undefined` (el state machine valida tipo `seller`, no identidad).
- **Impacto:** cualquier tenant logueado puede subir tickets falsos al storage de otro negocio (service-role) y empujar las Ã³rdenes ajenas por PREPARING â†’ READY_FOR_PICKUP â†’ IN_TRANSIT/DELIVERED (auto-complete a los 3 dÃ­as).
- **Fix:** gatear cada acciÃ³n con `getMemberPermissions(businessId, userId)` y abortar si el actor no resuelve.
- **Prioridad:** 6

### C7. `/api/billing/sunat-report` expone datos fiscales de TODOS los tenants
- **MÃ³dulo:** Panel (C3)
- **Evidencia:** `app/api/billing/sunat-report/route.ts:15-20` â€” solo `requireAuthenticatedUserId()` (presencia de sesiÃ³n). Devuelve **todos** los `planPayments` del mes (DNI/RUC, nombres, montos) de todos los negocios. **No existe rol admin en el codebase** (grep: sin `isAdmin`/`admin_role`; solo `SASS_API_KEY`).
- **Fix:** definir rol admin/platform y restringir el endpoint a ese rol.
- **Prioridad:** 7

### C8. Credencial real de Supabase en git history (`.env.example`)
- **MÃ³dulo:** Infra (C1)
- **Evidencia:** `.env.example` estÃ¡ trackeado y contiene string con formato `postgres://user:pass@*.supabase.co:5432` commiteado a lo largo de 15 commits (ej. 47836c1, 5d75164). `.gitignore` no lo cubre.
- **Impacto:** cualquiera con acceso al repo tiene credencial de la DB. Si la password sigue vÃ¡lida, la DB estÃ¡ expuesta.
- **Fix:** **ROTAR la password de Supabase YA**, reemplazar valores en `.env.example` por placeholders, idealmente reescribir historia con `git filter-repo`.
- **Prioridad:** 8

### C9. Migraciones no reproducibles â€” una DB fresca no se puede reconstruir
- **MÃ³dulo:** Infra (C2)
- **Evidencia:** `migrations/meta/_journal.json` termina en idx 24 (`0024_messy_nehzno`); ~25 archivos SQL no estÃ¡n en el journal (0025-0048 + manuales con prefijos duplicados: 0025Ã—3, 0019Ã—4, 0018Ã—3). `migrations/meta/0025_snapshot.json` estÃ¡ **untracked**. `migrations/README.md:11-22` confirma que la cadena manual es "canonical".
- **Impacto:** `drizzle-kit migrate` en un clone fresco aplica solo lo journaled â†’ la DB nueva **silenciosamente** no tiene idempotency keys, recojo, feedback, constraints de integridad, precios, estado WhatsApp, RLS reassertsâ€¦
- **Fix:** script de bootstrap que replique la cadena manual en orden documentado, decidir snapshot (commit o delete), job CI que provisione DB descartable y verifique paridad.
- **Prioridad:** 9

### C10. Realtime filtra chats cross-tenant a cualquier suscriptor anÃ³nimo â€” âš ï¸ CÃ“DIGO COMPLETO, BLOQUEADO POR C1
- **MÃ³dulo:** Auth (F2)
- **Estado:** âœ… El fix de cÃ³digo se aplicÃ³ el 26/09 en `5ce5c1f7` ("fix(chat): scope order-chat realtime subscription to session"), que es ancestro de `develop`. El comentario literal "sin server-side filter" que cita esta auditorÃ­a **ya no existe** en el cÃ³digo.
- **Evidencia (hoy):** `OrderChatSection.tsx:118` â†’ `filter: \`session_id=eq.${sessionId}\`` server-side; `:122-124` mantiene el filtro cliente de `session_id`/`payment_id` como defense-in-depth. Fijado por `tests/unit/orderChatSectionFilter.test.tsx:133`. Las server actions `fetchMessages`/`sendMessage` ya son actor-gated vÃ­a `resolveSessionActor` (`chatActions.ts:20-83`).
- **Residual (â›” bloqueado, NO es cÃ³digo):** sin RLS en `chat_sessions`/`messages` el filtro de canal es cosmÃ©tico. Supabase aplica el `postgres_changes` filter **despuÃ©s** de autorizar, asÃ­ que con el anon key pÃºblico un atacante no necesita canal realtime: `GET /rest/v1/messages?select=*` devuelve todas las filas de todos los tenants. El `filter:` arregla el **canal**; el RLS arregla los **datos**.
- **âš ï¸ Second-order blocker (Anexo A C1):** Drizzle conecta vÃ­a `postgres(DATABASE_URL)` y **bypassa RLS** (`src/core/database/client.ts:14,46`). Antes de aplicar las policies hay que auditar cada lectura supabase-js de `messages`/`chat_sessions` o el tracking y el dashboard se rompen.
- **AcciÃ³n:** NO reabrir el trabajo de cÃ³digo. Este item queda en el camino crÃ­tico de Grupo 1 **solo como dependencia de C1**. **No tildar** hasta que C1 estÃ© aplicado y verificado contra la DB live.
- **Prioridad:** 10 (residual, atada a C1)

### C11. RecuperaciÃ³n de acceso por DNI+orderNumber sin rate limit y cross-tenant â€” âš ï¸ ANCLA ELIMINADA, EL RIESGO MIGRÃ“
- **MÃ³dulo:** Auth (F5)
- **Estado:** â›” La funciÃ³n nombrada **ya no existe**. `verifyOrderAccessByDniAndOrderNumber` y su Ãºnico caller (`TrackOrderModal`) se borraron el 25/09 en `f0efd09` ("chore(order): remove dead DNI-order access path and TrackOrderModal"), ancestro de `develop`. El body borrado era exactamente el citado abajo. **Borrarla fue la remediaciÃ³n correcta**: no hay Redis, no hay limiter, no hay superficie. `/api/order/track` tampoco existe â€” `app/api/order/` solo contiene `lookup/route.ts`.
- **Lo que sobrevive (live, sigue sin arreglar):**
  1. `POST /api/order/lookup` â€” `route.ts:103` consulta `(buyerDni, orderNumber)` **global, sin `businessId`**; el slug se aplica como post-filter en `:128` devolviendo **403 vs 404** â†’ orÃ¡culo de existencia cross-tenant textual ("Â¿este DNI comprÃ³ en alguna tienda?"). El rate limit `(IP, dni)` = 10/15min **por DNI**, asÃ­ que con un DNI conocido el atacante enumera `orderNumber`, que es `ORD-${Date.now().toString(36)}` (base-36 de milisegundos, ~300.000 valores por ventana de 5 min). On success devuelve `{ token: trackingToken }`.
  2. `order/verify/[orderNumber]/page.tsx` â€” **peor que el C11 original**: sin credencial alguna (key = `businessId + orderNumber`, la mitad *predecible* sin el DNI), **sin rate limit**, sin cookie gate. Disclosea Ãºltimos 4 del DNI del comprador (`:352`), carrito completo, monto y un link con el `trackingToken` (`:361-363`). **Impreso en el ticket** (`ticket/generate/route.ts:188`). Ver **W-P4**, reescalado a Grupo 1.
- **Impacto:** brute-force y sonda de recon por tenant, sobre superficies distintas a las que este hallazgo describÃ­a.
- **Fix:** slug dentro del WHERE (no post-filter) + respuesta Ãºnica neutra; gate por cookie firmada + rate limit `(IP, orderNumber)` en la pÃ¡gina verify.
- **Prioridad:** 11 â†’ effectively Grupo 1 (ver Â§6 Grupo 1)

---

## 3. WARNING relevantes (no bloquean pero hay que cerrarlos)

### Auth & sesiones
- **W-A1** â¬†ï¸ **REESCALADO a Grupo 1** â€” Transiciones de estado del cliente sin prueba: `updateOrderStatus`/`reportIssueV2` (`actions.ts:60-70,349-363`) â€” `callerProof` opcional; con `paymentId` + `trackingToken` (ambos en el payload RSC) cualquiera con el link puede flipear estados (DELIVERED, DISPUTE, ISSUE_REPORTED) desde la consola.
  - **âš ï¸ La premisa de esta auditorÃ­a quedÃ³ invertida por el fix de C4.** Se suponÃ­a que C4 quitarÃ­a `paymentId` del payload no autenticado. C4 hizo lo contrario **a propÃ³sito**: `page.tsx:50` incluye `id: true` en `PUBLIC_ORDER_COLUMNS` y `ActionModals.tsx:9-21` lo consume desde el payload pÃºblico. O sea: `paymentId` es **permanente por diseÃ±o** hasta que algo lo cambie explÃ­citamente. `git grep` confirma que sÃ³lo queda el gate `and(eq(payments.id,â€¦), eq(payments.trackingToken,â€¦))` â€” ambos conocidos por el atacante.
  - **Cuarta acciÃ³n que esta auditorÃ­a no detectÃ³:** `confirmFinalization(paymentId, token)` (`finalizationActions.ts:266-290`) **no tiene parÃ¡metro de prueba alguno**; flipea `WAITING_CUSTOMER_CONFIRMATION â†’ CONFIRMED`.
  - **RemediaciÃ³n hoy disponible:** `verifyOrderAccessCookie(trackingToken)` (HMAC-SHA256, httpOnly, ilegible desde JS) es estrictamente mejor que `callerProof`, que se reconstruye desde localStorage falseable â€” la propia crÃ­tica que C4 le hizo.
  - **Nota:** `syncChatSession` no tiene prueba **por diseÃ±o** (R17 lo ata al `paymentId` + `businessId` exactos; si no, identidad `guest-${paymentId}`). No es un hallazgo.
- **W-A2** â¬†ï¸ **LEAK CONFIRMADO VIVO** â€” DNI como credencial en URL `?dni=`. El link de auth es inalcanzable bajo R15, pero el `router.replace` que limpia la URL vive **dentro del branch de Ã©xito, que nunca se toma** (`OrderAuthGate.tsx:195-198`) â†’ **el DNI queda en la barra de direcciones toda la sesiÃ³n**: history, `Referer` de cada request saliente, y cualquier screenshot. AdemÃ¡s consume un token del rate-limit `(IP, dni)` **de la vÃ­ctima** si el link se le envÃ­a. La parte de `guestId = 'dni-{dni}'` vinculando chats pre/post compra **ya estÃ¡ neutralizada** (R17: en el path pÃºblico `buyerDni` es `null` â†’ el visitante obtiene `guest-${paymentId}`).
- **W-N1** â¬†ï¸ **HALLAZGO NUEVO (02/10/2026), no estaba en la auditorÃ­a** â€” Ã“rdenes con `orderNumber = NULL` **no tienen ningÃºn path de autenticaciÃ³n funcional**. `payments.order_number` es nullable (`schema/orders.ts:85`) y `charge/route.ts:545` escribe `null` cuando no viene en metadata. Para esas filas R15 rechaza el `?dni=` (`actions.ts:145`) **y** el formulario manual rechaza tambiÃ©n (`OrderAuthGate.tsx:361-364` â†’ "Por favor, ingresÃ¡ el NÂ° de orden"). El comprador ve un formulario que no puede funcionar. Fix correcto: `orderNumber` server-generated no-null (deferido con W-P4) + estado explÃ­cito no-enviable en la UI.
- **W-A3** Rate limits in-memory keyed `x-forwarded-for` â†’ spoofeable, se resetean en cada deploy/instancia.

### Checkout & pagos
- **W-P1** Token flow: carga a Culqi ANTES de reservar idempotencia (`charge/route.ts:285-308`; create-order lo hace bien). Timeout post-Ã©xito + retry = doble cobro en los casos ambiguos.
- **W-P2** Rate limiter por `businessId:productId` (3/30s), no por buyer â†’ un atacante agota el bucket de un producto real.
- **W-P3** Sin conciliaciÃ³n: webhook `charge.paid` solo hace `UPDATE payments SET status='paid'` (`webhooks/culqi/route.ts:223-229`); no puede crear el payment del order-flow. Cliente paga en la ventana de Culqi, cierra el tab â†’ **plata recibida sin registro ni notificaciÃ³n**. No hay cron de conciliaciÃ³n ni GET a Culqi.
- **W-P4** â¬†ï¸ **REESCALADO de Grupo 2 a Grupo 1 CRITICAL (02/10/2026)** â€” `orderNumber` client-controlled y predecible: `ORD-${Date.now().toString(36)}` (base-36 de milisegundos, ~300.000 valores por ventana de 5 min), metadata arbitraria (`schemas.ts:30`).
  - **Por quÃ© el reescalado:** la pÃ¡gina `order/verify/[orderNumber]/page.tsx:48-65` consulta por `businessId + orderNumber` **sin gate de DNI**, **sin rate limit** (`proxy.ts` solo asigna config a `/auth/` y `/api/`; `RATE_LIMITS.storefront` existe pero nunca se usa), y **sin cookie gate**. Cuando la orden existe y `status !== 'failed'` disclose Ãºltimos 4 del DNI (`:352`), carrito completo, monto y **un link con el `trackingToken`** (`:361-363`). **Es alcanzable por diseÃ±o**: `CheckoutSuccessView.tsx:160` la linkea como recibo y `api/ticket/generate/route.ts:188` la **imprime en el ticket** â€” el `orderNumber` viaja en el artefacto que el comprador lleva encima.
  - **Es la misma raÃ­z que C11 pero mÃ¡s explotable:** C11-era el ancla DNI+orderNumber; esta superficie usa **sÃ³lo la mitad predecible** y no requiere ninguna credencial.
  - **Se parte en dos:** (a) el **gate** de la pÃ¡gina verify â€” entra en este change; (b) el **fix de raÃ­z** `orderNumber` server-generated Ãºnico â€” diferido, porque toca `charge/route.ts`, `useCulqiCallback.ts` y `create-order/route.ts`, el money path compartido con C2/W-P3. El fix de raÃ­z ademÃ¡s mata el espacio de enumeraciÃ³n y resuelve W-N1 de un tiro.
- **W-P5** `update-ticket` es UPDATE multi-fila keyed por `orderNumber` (no-Ãºnica, client-supplied) â†’ puede corromper filas de otras Ã³rdenes/negocios (`update-ticket/route.ts:57-62`).
- **W-P6** `payments.status` texto libre con doble vocabulario; escriben `'paid'` directo sin `transition()`/version check.
- **INFO:** dedup de webhook in-memory (10min, multi-instancia â†’ duplicados), fallback zero-key en `crypto.ts`, `trackingToken` 8 chars alfabeto 30 con mod bias.

### Panel & admin
- **W-D1** `/api/business/penalties` GET sin auth â€” lista penalidades de cualquier businessId (`route.ts:15-45`).
- **W-D2** `/api/business/penalty-status` GET sin auth â€” expone `culqiBlocked`, `blacklisted`, `penaltyDebt` (`route.ts:13-46`). Contrasta con el POST pay que sÃ­ verifica.
- **W-D3** `/api/order/lookup` â€” `findFirst` sin filtro slug (`and(eq(ownerId, user.id))` only): un seller dueÃ±o de varias tiendas puede auto-confirmar Ã³rdenes de otra tienda propia, y la query dni+orderNumber no es slug-scoped (403 legÃ­timo en colisiones).
- **W-D4** Imports: raw error leaks al cliente, payload sin tope mÃ¡ximo, `GET [jobId]` con side effects.
- **INFO:** broadcast key-protected pero sin validar existencia/subscripciÃ³n del target; `/api/business/permissions` sin membership check.

### WhatsApp & YCloud (riesgo 2/5)
- **W-W1** Dedup del webhook marca `seen` ANTES del try/catch (`webhooks/ycloud/route.ts:446-449`) â†’ retry de YCloud tras fallo transitorio de DB se descarta â†’ **pÃ©rdida permanente de mensajes**. Fix: marcar seen solo tras Ã©xito (o columna event_id).
- **W-W2** Sin gating de plan/subscripciÃ³n para WhatsApp: vendedores con plan vencido o `isActive=false` pueden conectar y mandar mensajes, generando costos de Meta a **tu** cuenta YCloud (`entitlements/plans.ts` no tiene flag whatsapp; `connect/init` solo checa `ownerId`).
- **W-W3** `whatsappActions.ts:29-52` usa `verifyBusinessAccess` = owner O cualquier membresÃ­a; el modelo de permisos existe (`chat.respond`, `chat.view` en `definitions.ts:235`) y se usa en `chatActions.ts:55-56` pero no acÃ¡ â†’ un miembro sin permisos puede mandar WhatsApp como el negocio.
- **W-W4** Onboarding del dashboard roto: `WhatsAppConnectButton.tsx` muestra el modal con cÃ³digo `undefined` porque `/connect/init` ya no entrega `code`/`expiresAt` (usa adopciÃ³n). UX rota en pÃ¡gina viva; el path de ChatClient estÃ¡ bien. Fix: redirigir al popup de coexistence o actualizar la pÃ¡gina.
- **INFO:** orÃ¡culo de existencia en connect/status (404 vs 403), tipos de mensaje sin whitelist guardan payload crudo (PII, coordenadas), send no re-verifica `isActive`, `templates/sync` N+1 sin timeout, URL de template acepta `javascript:`.

### Infra / datos / observabilidad
- **W-I1** Rate limiting in-memory y spoofeable: `x-forwarded-for` primero (`rateLimit.ts:85-91`); `RATE_LIMITS.storefront` definido pero **nunca usado**; webhooks comparten bucket 30/min con todo /api â†’ bursts legÃ­timos 429. Fix: Upstash/Redis + header verificado por plataforma + lÃ­mite separado para webhooks.
- **W-I2** CSP con `unsafe-inline` + `unsafe-eval`, sin `object-src 'none'` ni `report-uri` (`next.config.ts:37`) â†’ casi inÃºtil contra XSS y sin reporte. Fix: nonce/hash en prod.
- **W-I3** Logs con keywords de secretos en la raÃ­z del repo, NO gitignoreados: `dev-server*.log` (46 hits de patrones key/secret/password en `dev-server.err.log`). Un `git add -A` los commitea.
- **W-I4** Footer de tenant linkea `/{slug}/terminos` pero **no existe** ruta tenant de terminos/privacidad (`app/[slug]/(app)/Footer.tsx:126`) â†’ link legal roto en cada tienda.
- **INFO:** `CULQI_WEBHOOK_SECRET` leÃ­do pero no documentado (si se usÃ³ HMAC en prod y no estÃ¡ seteado â†’ 401 silencioso); dedup webhook per-instancia; `.vercel/` con env locales (ignorado, ok); broadcast usa `!==` no timing-safe.

---

## 4. Lo que SÃ estÃ¡ sÃ³lido (no tocar)

- **WhatsApp/YCloud:** webhook HMAC-SHA256 con ventana 5min + fail-closed en prod; aislamiento tenant en los 6 routes; state machine con `failed` que limpia `isActive`/`connectedAt`; cero `dangerouslySetInnerHTML`; CSP cubre Meta popup.
- **Pagos:** validaciÃ³n de precio 100% server-side (`validateAmount` contra DB, centavos exactos); webhook Culqi con Basic/HMAC timing-safe; secret keys solo server-side, AES-256-GCM en reposo con gate `CULQI_ENFORCE_LIVE_KEYS`; tabla de idempotencia DB-backed con `onConflictDoNothing`; stock con CHECK `>= 0`.
- **Auth lado vendedor:** layouts de dashboard/chat/notifications con `getMemberPermissions`; API de notificaciones autoriza vÃ­a `businessId` propio de la notificaciÃ³n (no query param).
- **Panel:** los read surfaces (pages/layouts/entitlements/notifications/whatsapp) son sÃ³lidos; penalidades pay, purchase-plan, update-ticket bien gateados.
- **Infra:** cero hardcoded secrets en cÃ³digo fuente; headers de seguridad buenos (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy); Sentry server+client+edge + PostHog ya montados; CI completo (lint, typecheck, audit, unit + e2e); crons protegidos con `CRON_SECRET`; pÃ¡ginas legales platform-level existen con tests y sitemap; robots.ts desindexa /api, /auth, dashboards.

---

## 5. Investigaciones pendientes (algunas requieren acceso LIVE)

1. ðŸ”² **RLS vivo en Supabase** â€” Â¿el proyecto live tiene policies que las migraciones no reflejan? (drift check)
2. ðŸ”² **Validez de la password del `.env.example`** â€” asumir comprometida; rotar igual.
3. ðŸ”² **Rate limiting real** â€” decisiÃ³n architecture: Upstash/Redis vs otra (costo).
4. ðŸ”² **Gap de conciliaciÃ³n Culqi** â€” mapear flujo completo webhook Ã— order-flow Ã— cron.
5. ðŸ”² **Gating de plan WhatsApp** â€” confirmar si es decisiÃ³n de producto (free tier incluye WhatsApp) o exposure.
6. ðŸ”² **`CULQI_WEBHOOK_SECRET` en Vercel** â€” si no estÃ¡ seteado y el webhook usa HMAC, prod 401.
7. ðŸ”² **Prefijos duplicados de migraciones** â€” orden exacto de replay de la cadena manual.
8. ðŸ”² **Bucket de storage `tickets`** â€” policies de acceso (fuera del repo).
9. ðŸ”² **Vercel multi-instance** â€” confirmar header de IP confiable para rate limiting.
10. ðŸ”² **Rol admin** â€” Â¿se planea identidad platform-admin? (necesario para sunat-report)

---

## 6. Checklist de remediaciÃ³n priorizada

### Grupo 0 â€” HOY (seguridad inmediata, sin esperar plan)
- [ ] Rotar password de Supabase (C8)
- [ ] Borrar `dev-server*.log` y agregar `*.log` al `.gitignore` (W-I3)
- [ ] Decidir destino de `migrations/meta/0025_snapshot.json` (commit o delete) (C9)
- [ ] Reemplazar valores del `.env.example` por placeholders (C8)

### Grupo 1 â€” Bloqueantes de beta (no abrir sin esto)
- [ ] Habilitar RLS + policies en `payments`, `payment_orders`, `payment_idempotency_keys`, `chat_sessions`, `messages`, `businesses`; confirmar paridad con live (C1) â€” **desbloquea C10**
- [ ] VerificaciÃ³n server-side de `culqiOrderId` en `/api/payment/charge` (C2) â€” PR #203 draft, sin mergear
- [x] Allowlist de origin en /auth/customer postMessage (C3) �? ya implementado en pp/auth/customer/page.tsx con isAllowedAuthReturnOrigin + allowlist (same-origin + NEXT_PUBLIC_AUTH_ORIGIN). Verificado con tests 	ests/unit/url.test.ts y 	ests/unit/customerAuthPage.test.tsx (66 passed), PR #199/#201/#202. Residual: SSR guard en isAllowedAuthReturnOrigin no cr�tico (sólo se invoca client-side).
- [ ] Datos sensibles de la orden detrÃ¡s de verificaciÃ³n server-side + fix `orderNumber IS NULL` (C4) â€” PR #205 draft, sin mergear
- [x] Auth + ownership en `/api/ticket/generate` (C5) → ya implementado: gate owner-or-buyer en `app/api/ticket/generate/route.ts:105` (`requireOwnedBusinessById(payment.businessId)`) con fallback a comparación de `trackingToken` (`safeTokenEqual`, 401 en `:114`). Commit `5513219f` (PR #195). Test `tests/unit/ticketGenerateRoute.test.ts`.
- [x] `getMemberPermissions` en `ticketActions`/`finalizationActions` + abort si actor no resuelve (C6) → ya implementado: `requireOrderManager()` en `ticketActions.ts:68-76` y `finalizationActions.ts:72-80`, vía `checkPermission(businessId, actorId, 'orders.manage')`; aborta `{ok:false}` si `getAuthenticatedUserId()` es null. Commit `771b697` (PR #195/#221). Tests `ticketActionsRoute` + `finalization*`.
- [x] Rol admin para `/api/billing/sunat-report` (C7) → ya implementado: `route.ts:23-35` acepta `x-sass-key === env.sassApiKey` (con guard `!!env.sassApiKey`) o exige `env.platformAdminIds.includes(userId)`; 401 si no. Documentado en JSDoc `:10-17`.
- [ ] ~~Filtro server-side de `session_id` en `OrderChatSection` realtime (C10)~~ â†’ **cÃ³digo ya hecho en `5ce5c1f7`; â›” residual bloqueado por C1. NO tildar hasta que C1 estÃ© verificado contra la DB live**
- [ ] ~~Rate limit en `verifyOrderAccessByDniAndOrderNumber` (C11)~~ â†’ **funciÃ³n eliminada en `f0efd09`; no hay nada que rate-limitar**. El riesgo residual vive en las 2 superficies de abajo
- [ ] â¬†ï¸ Gate por cookie firmada en `updateOrderStatus`/`reportIssueV2`/`confirmFinalization` (W-A1 reescalado â€” C4 volviÃ³ permanente `paymentId` en el payload pÃºblico)
- [ ] â¬†ï¸ `businessSlug` dentro del WHERE de `/api/order/lookup` + respuesta Ãºnica neutra (elimina el orÃ¡culo 403/404 cross-tenant) (W-D3 / C11 residual)
- [ ] â¬†ï¸ Gate por cookie en la pÃ¡gina `order/verify/[orderNumber]`: narrowing del SELECT + cart y link `trackingToken` detrÃ¡s del gate, **conservando el veredicto pÃºblico** (valid/invalid + DNI enmascarado + monto) para no romper el ticket impreso + rate limit `(IP, orderNumber)` vÃ­a `headers()` (W-P4 gate)
- [ ] â¬†ï¸ Borrar el flujo `?dni=` (`OrderAuthGate.tsx:180-211`) â€” la fuga del DNI a history/referrer sigue viva (W-A2)
- [ ] â¬†ï¸ Estado no-enviable explÃ­cito para Ã³rdenes con `orderNumber = NULL` (W-N1)
- [ ] Auth en `/api/business/penalties` GET y `/api/business/penalty-status` GET (W-D1, W-D2)

### Grupo 2 â€” Antes de 20-50 usuarios reales
- [ ] Certificar estado del webhook y crear path de conciliaciÃ³n de pagos (W-P3)
- [ ] Idempotencia: reservar ANTES de cargar a Culqi en token flow (W-P1)
- [ ] Rate limiting real (Redis/Upstash) + header de IP confiable + storefront + separar webhooks (W-I1) â€” **nota: los limiters in-memory son speed bumps, no muros; un deploy o una rotaciÃ³n de IP los resetea**
- [ ] Gating de plan WhatsApp (connect/init, complete, templates, send) + `isActive` (W-W2)
- [ ] Permisos `chat.respond`/`chat.view` en `whatsappActions` (W-W3)
- [ ] Fix dedup webhook YCloud: marcar seen solo tras Ã©xito (W-W1)
- [ ] Bootstrap de migraciones reproducible + CI de paridad (C9)
- [ ] `payments.status` enum + CHECK + rutear por `transition()` (W-P6)
- [ ] â¬†ï¸ **Fix de raÃ­z de W-P4 (subiÃ³ desde acÃ¡):** `orderNumber` server-generated Ãºnico + no-null + gate verify por DNI/token â€” **el de mayor apalancamiento de toda la auditorÃ­a**: mata el espacio de enumeraciÃ³n base-36, elimina el `metadata.orderNumber` client-controlled y resuelve W-N1 de un golpe. Toca el money path (`charge/route.ts`, `useCulqiCallback.ts`, `create-order/route.ts`), por eso quedÃ³ fuera del change actual.
- [ ] `update-ticket` scope por paymentId + ownership (W-P5)
- [ ] Rate limit por buyer en charge + limiter por DNI/email (W-P2)
- [ ] ~~`callerProof` obligatorio o acciones ligadas a sesiÃ³n server-side (W-A1)~~ â†’ **subiÃ³ a Grupo 1**; el gate por cookie firmada lo resuelve sin tocar `callerProof`

### Grupo 3 â€” Higiene / no urgentes
- [ ] CSP nonce/hash + `object-src 'none'` + report-uri (W-I2)
- [ ] PÃ¡gina tenant `/terminos` (o apuntar footer a platform pages) (W-I4)
- [ ] Documentar `CULQI_WEBHOOK_SECRET` en `.env.example`/env.ts
- [ ] Fix onboarding WhatsApp del dashboard (W-W4)
- [ ] Whitelist de tipos de mensaje en webhook YCloud + log sin telÃ©fono (W-W6/INFO)
- [ ] Limpiar `proxy.ts` vs `src/middleware.ts` (dead code)
- [ ] `templates/sync` con timeout y concurrency cap
- [ ] URL de template restringida a http(s)

---

## 7. Anexos

### Anexo A â€” InvestigaciÃ³n profunda: remediaciÃ³n file-level (24/09/2026)

> InvestigaciÃ³n delegada (2 agentes read-only) para mapear el fix mÃ­nimo de cada bloqueador: estado actual, patrÃ³n del repo que ya resuelve el problema, pasos exactos, esfuerzo y riesgos.

#### Auth & Panel

**C3 â€” `/auth/customer` origin sin validar (Effort: M)**
- Estado: `app/auth/customer/page.tsx:40` lee `searchParams.get('origin')` (atacante-controlado) y lo usa como target de `postMessage` para `AUTH_ERROR` (:72), `AUTH_SUCCESS` (:78-86) y `handleContinueWithCurrent` (:133-141). El receptor sÃ­ valida (`OrderAuthGate.tsx:219`); el emisor no.
- PatrÃ³n a reusar: `AUTH_ORIGIN = process.env.NEXT_PUBLIC_AUTH_ORIGIN || window.location.origin` (ya definido en OrderAuthGate, ChatDialog, Checkout, LookupOrderModal, features/auth). Helpers de tenant host en `src/shared/utils/url.ts` (`isTenantHost`, `extractTenantSlugFromHost`).
- Fix: crear `isAllowedAuthReturnOrigin(origin)` en `src/shared/utils/url.ts` (acepta same-origin + `NEXT_PUBLIC_AUTH_ORIGIN`; preparar rama tenant-host para el futuro subdomain). Chequear antes de cada `postMessage` en `auth/customer/page.tsx` y en los otros 3 sitios emisores (`ChatDialog.tsx:449,488`, `Checkout.tsx:187,224`, `LookupOrderModal.tsx:97`).
- Riesgo: `featureSubdomainRewrite` es fase 2 (`url.ts:78`) â€” hoy prod es single-origin; no habilitar la rama tenant-host hasta que exista.

**C4 â€” PII de la orden en SSR + gate cosmÃ©tico (Effort: M)**
- Estado: `order/[token]/page.tsx:61-64` trae la fila completa de `payments` (sin proyecciÃ³n de columnas) y la renderiza: pickupCode (~875/944), ticketImageUrl (~1283), buyerEmail/DNI â†’ props de OrderChatSection (:1248-1250), shipping (~1472-1519), contacto (~1541-1555), customerAuth (~1560-1630). Gate client-only con `order_session_${token}` en localStorage, TTL 1h. Bug `orderNumber IS NULL`: `verifyOrderAccess` (`actions.ts:156`) â€” `null !== null` es falsy (~176-182) â†’ DNI pelado abre la orden.
- PatrÃ³n a reusar: `getOrderDetails.ts` **ya existe pero no se usa** (server action que verifica `CallerProof` contra buyerDni o authId y devuelve solo subset seguro). `ActionModals.tsx:9-21` y `ReportV2Flow.tsx:10-19` ya reconstruyen CallerProof desde localStorage.
- Fix: (1) proyecciÃ³n de columnas en `page.tsx:61-64` EXCLUYENDO PII; (2) en `verifyOrderAccess`/`ByDniAndOrderNumber`/`ByGoogleIdentity` exitosos setear cookie `order_access_${token}` httpOnly firmada (TTL 1h, secret nuevo en `env.ts`); (3) SSR: con cookie vÃ¡lida traer fila completa, sin cookie servir proyecciÃ³n pÃºblica (props PII nullable); (4) NULL orderNumber â†’ exigir `verifyOrderAccessByDniAndOrderNumber`, nunca pasar por el branch `null !== null`; (5) `LogoutButton` limpia localStorage â€” agregar server action que limpie la cookie.
- Riesgo: no limpiar la cookie en logout la deja viva (logout cosmÃ©tico).

**C5 â€” `/api/ticket/generate` sin auth (Effort: S)**
- PatrÃ³n exacto a copiar: `app/api/payment/update-ticket/route.ts:44-47` â†’ `try { await requireOwnedBusinessById(payment.businessId) } catch { return 401 }` (helper en `@/features/storage/actions/authz:123-139`).
- Fix: en `ticket/generate/route.ts`, tras buscar el payment por orderNumber, mismo gate antes de generar/subir. `forceRegenerate` queda implicitamente owner-only. Actualizar `tests/unit/ticketGenerateRoute.test.ts` (unauthenticated â†’ 401).

**C6 â€” Server actions sin ownership (Effort: M â€” 6 acciones, 2 archivos)**
- Estado: `ticketActions.ts:15-46` y `finalizationActions.ts:20-51` definen `getAuthenticatedUserId()` LOCAL que devuelve `null` en fallo y no aborta; las 6 acciones solo comparan `existingPayment.businessId !== businessId` (businessId es client-supplied).
- Fix: reemplazar la comparaciÃ³n por `await requireOwnedBusinessById(existingPayment.businessId)` y dejar propagar el throw; usar `requireAuthenticatedUserId` de `authz.ts:10` para el actor id.
- âš ï¸ DecisiÃ³n pendiente: owner-only bloquea a team members de operaciones de Ã³rdenes. Si se quiere acceso de equipo, usar `requireAccessOnId(businessId, 'dashboard.view')` o crear permiso `orders.manage`.

**C7 â€” `sunat-report` (Effort: S)**
- No existe rol admin: los roles son business-scoped. PatrÃ³n a reusar: `SASS_API_KEY` en `app/api/sass/notifications/broadcast/route.ts:24-31`.
- Fix mÃ­nimo (cero migraciones): `PLATFORM_ADMIN_IDS` (comma-separated) en `src/config/env.ts`; en la ruta `requireAuthenticatedUserId()` + `if (!PLATFORM_ADMIN_IDS.includes(userId)) return 401`; si lo consumen scripts, aceptar tambiÃ©n header `x-sass-key`.
- âš ï¸ DecisiÃ³n: env allowlist vs columna DB de rol platform.

**C10 â€” Realtime sin filter (Effort: S)**
- PatrÃ³n correcto ya existe: `ChatDialog.tsx:251-260` `filter: 'session_id=eq.${sessionId}'`; `messages.sessionId` y `messages.paymentId` existen en `schema/chat.ts:55-62`.
- Fix: agregar el mismo `filter` al canal de `OrderChatSection.tsx:106-120` (sessionId disponible en el componente); mantener check client-side de payment_id como defense-in-depth.

**C11 â€” DNI+orderNumber sin rate limit (Effort: S)**
- PatrÃ³n a reusar: `src/lib/rateLimit.ts` â€” `checkRateLimit(identifier, config)`, `getClientIdentifier(request)`, `RATE_LIMITS.auth = { windowMs: 15min, max: 10 }`. El otro path (`verifyOrderAccess:159`) ya tiene 5/15min local.
- Fix: (1) en `verifyOrderAccessByDniAndOrderNumber` (`actions.ts:197`) agregar el mismo check local 5/15min; (2) en `track/route.ts` y `lookup/route.ts` POST, `checkRateLimit(getClientIdentifier(request), RATE_LIMITS.auth)` antes del Zod parse, 429 con Retry-After. Ojo: las server actions **bypasean `proxy.ts`** â€” el lÃ­mite a nivel acciÃ³n es la Ãºnica protecciÃ³n.

**W-D1 â€” `GET /api/business/penalties` (Effort: S)**
- Ãšnico caller: `PenaltiesClient.tsx:115` (dashboard autenticado). Fix: `try { await requireOwnedBusinessById(businessId) } catch { return 401 }` tras el check de 400 (`:21-23`), igual que `pay/route.ts:39-47`.

**W-D2 â€” `GET /api/business/penalty-status` (Effort: S â€” OJO trampa)**
- âš ï¸ El **storefront pÃºblico** lo llama: `Checkout.tsx:124` lo usa para el banner "no acepta pagos". Un owner-gate pelado rompe checkout.
- Fix en dos ramas segÃºn auth: (1) sin auth â†’ `{ canAcceptPayments, culqiBlocked, blacklisted }` (banner-safe); (2) con `requireOwnedBusinessById` OK â†’ agregar `penaltyDebt` + `penaltyCount`. Actualizar Checkout.tsx si es necesario (ya solo lee los 3 campos del banner).

#### Payments & Infra

**C2 â€” Free-order exploit (Effort: M)**
- Estado confirmado: `charge/route.ts:277-279` â€” el branch `isOrderFlow` es un comentario vacÃ­o; el POST con solo `culqiOrderId` salta a la transacciÃ³n que inserta `payments` `paid` (:358-390), descuenta stock (:404-409) y flipea `payment_orders` (:393-398). `chargeRequestSchema` permite `culqiOrderId` sin token (`schemas.ts:14-15,55-57`). No existe cliente Culqi: todo es `fetch` inline con `Authorization: Bearer`.
- PatrÃ³n a reusar: `resolveCulqiSecretKey(businessId)` (`charge/route.ts:51-96`), patrÃ³n fetch con AbortController 15s (`create-order/route.ts:180-207`), statuses conocidos `paid|expired|cancelled` (`webhooks/culqi/route.ts:261-265`).
- Fix: reemplazar el branch vacÃ­o con `GET https://api.culqi.com/v2/orders/{id}` usando la secret key del negocio y exigir `status === 'paid'`; rechazar 402/400 si no. **AdemÃ¡s**: el UPDATE de `payment_orders` por `culqiOrderId` (:393-398) estÃ¡ **sin scope de businessId** â€” agregar `and(eq(paymentOrders.businessId, businessId))`. Verificar forma real de la respuesta GET contra `src/types/culqi.d.ts`.

**C1 â€” RLS template (Effort: M escribir / L rollout seguro)**
- Patrones que ya existen para copiar (migraciones manuales): own-row (`0011_reassert_profiles_rls.sql:14-41`, `0040`), membership subquery `business_id IN (SELECT business_id FROM business_team_members WHERE user_id = auth.uid())` (`0019:63-72`), owner-derived (`0015:257-264`), related-table EXISTS (`0034:72-82`).
- Template propuesto: una migraciÃ³n manual `0049_rls_payments_chat_businesses.sql` idempotente con `--> statement-breakpoint` (convenciÃ³n de `scripts/apply-migration.mjs:40`): por tabla `ENABLE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS` + policies:
  - `payments`/`payment_orders`: SELECT owner/team vÃ­a subquery; lectura cliente vÃ­a `tracking_token`; CRUD restringido a service role.
  - `payment_idempotency_keys`: service-role only.
  - `chat_sessions`/`messages`: owner/team + guest vÃ­a `guest_id` (mantener chat de invitado funcionando).
  - `businesses`: owner full; anon/authenticated SELECT solo campos pÃºblicos de storefront.
- âš ï¸ RIESGO CLAVE: `db` (Drizzle) conecta directo vÃ­a `postgres(DATABASE_URL)` y **bypasea RLS** (`src/core/database/client.ts:14,46`) â€” solo los clientes supabase-js quedan limitados. Auditar TODOS los reads supabase-js de estas tablas antes (order track, realtime, dashboard) o se rompen al aterrizar las policies.

**W-P3 â€” ConciliaciÃ³n (Effort: L)**
- Flujo confirmado: `create-order` (`confirm: false`) crea `payment_orders` `pending`; webhook `order.status.changed` flipea `payment_orders` pero **nunca crea `payments`**; `charge.paid` solo UPDATEa filas existentes; la fila `payments` la crea SOLO el POST del cliente (`charge/route.ts:358-390`). Si el tab se cierra tras pagar en Culqi â†’ **plata recibida sin registro**. Peor: mÃ©todos async (PagoEfectivo/Billetera) nunca llaman a `/api/payment/charge` (`useCulqiCallback.ts:208-217`).
- Fix en dos capas: (1) **Webhook upsert (primario)**: en `webhooks/culqi/route.ts` `order.status.changed` + `paid` â†’ upsert de `payments` idempotente (unique `culqi_charge_id`); requiere `productId` en `payment_orders` (hoy `create-order` lo manda a Culqi pero no lo guarda) â†’ migraciÃ³n manual; `sellerUserId = businesses.ownerId`; `trackingToken = generateTrackingToken()`. Extraer side-effects de stock/notify de `charge/route.ts:404-454` a un servicio compartido. (2) **Cron de reconciliaciÃ³n (backstop)**: nuevo `app/api/cron/reconcile-payments/route.ts` copiando el patrÃ³n de `order-timeouts` (CRON_SECRET) â€” `payment_orders` `paid` sin `payments.culqi_charge_id` â†’ GET `/v2/orders/{id}` â†’ crear fila.
- Riesgo: `payments.productId`/`sellerUserId` son NOT NULL (`schema/orders.ts:47-52`); doble-create con el callback se evita con unique + `onConflictDoNothing`; side-effects deben ser idempotentes (event table o `order_events`).

**W-W2 â€” Gating de plan WhatsApp (Effort: Sâ€“M)**
- âš ï¸ Dato nuevo: `chatEnabled` es `true` en los TRES planes (`plans.ts:115,129,143`) y su Ãºnico consumidor es un filtro de UI. No existe flag whatsapp en `BusinessEntitlements` (`plans.ts:43-95`). `getBusinessEntitlements` ya resuelve plan+expiraciÃ³n.
- PatrÃ³n a reusar: gate estilo `hasPaymentGateway`: `charge/route.ts:252-261` (`if (!entitlements.hasPaymentGateway) return 403`).
- Fix: (1) agregar `whatsappEnabled` a `BusinessEntitlements` y a los planes (decisiÃ³n de producto: lite=false, pagos=true); (2) gate en `connect/init` (tras :44-51), `connect/complete` (tras :52-59), `connect/status` (tras :70-77) y en `sendWhatsAppMessage` (tras `verifyBusinessAccess` :246). La expiraciÃ³n ya degrada a lite (`getBusinessEntitlements.ts:56-65`) â€” solo falta la enforcement.

**W-W3 â€” Permisos en whatsappActions (Effort: S)**
- PatrÃ³n exacto: `import { checkPermission } from '@/lib/permissions'` (`chatActions.ts:6`); `'chat.respond'`/`'chat.view'` existen en `definitions.ts:18-19` y en los defaults de roles (:44-125); member default incluye `chat.respond` (`definitions.ts:115`).
- Fix: borrar `verifyBusinessAccess` local (`whatsappActions.ts:29-52`); `sendWhatsAppMessage` â†’ `checkPermission(businessId, userId, 'chat.respond')`; conversaciones/mensajes â†’ `'chat.view'`. Sweep opcional: `billing/route.ts:8`, `templates/route.ts:36`, `templates/sync/route.ts:22` usan el mismo patrÃ³n owner/membership.

**C9 â€” Bootstrap de migraciones (Effort: M)**
- Confirmado: journal termina en `0024`; **51 archivos fuera del journal** (incluye 2 huÃ©rfanos Drizzle: `0013_worried_shotgun`, `0025_lonely_firebird` ya representados en schema.ts â€” NO regenerar); `0025_snapshot.json` untracked; **no hay `.github/workflows/`** (no existe CI de paridad hoy).
- Fix en 3 piezas: (1) orden de replay por prefijo ascendente vÃ­a `scripts/apply-migration.mjs` (operador, README Â§6); (2) tabla `schema_migrations_manual` (file_name PK, applied_at, checksum) y que `apply-migration.mjs` haga upsert por archivo â€” hoy el runner no loguea nada; (3) workflow CI de paridad que falle si hay archivo manual sin marcador. Resolver destino del snapshot untracked ANTES de volver a correr `drizzle-kit generate`.
- Riesgo: `apply-migration.mjs` continÃºa tras error (README Â§6) â€” snapshotear DB antes del primer run. `0000_special_crystal` queda excluido (README Â§2).

**W-I1 â€” Rate limiting (Effort: S apretar / M Redis)**
- Tres capas, todas in-memory: `proxy.ts:36-60` (30/min por IP, per-instancia, storefront sin lÃ­mite), `src/core/payments/rateLimiter.ts:7-71` (3/30s keyed `businessId:productId` â€” ambos attacker-controlled en el body â†’ rotaciÃ³n los bypasea), `actions.ts:24` (local, tercera).
- OpciÃ³n A (cero infra, DB-backed): reemplazar el `Map` de `src/lib/rateLimit.ts` por tabla `rate_limits(key PK, window_start, count)` con upsert/prune; keyear charge/create-order por IP + business. OpciÃ³n B (estÃ¡ndar Vercel): `@upstash/ratelimit` con fallback al Map si no hay env.
- âš ï¸ Ojo doble: (1) el limiter de pagos corre DESPUÃ‰S de `validateAmount` (`charge/route.ts:208` vs `:219`) â€” moverlo antes para que los abusadores quemen budget en el check mÃ¡s barato; (2) `proxy.ts` aplica `RATE_LIMITS.api` a `/api/*` **incluidos los webhooks** (`:38-40`) â€” al apretar lÃ­mites, EXIMIR `/api/webhooks/*` o los eventos de pago/WhatsApp empiezan a fallar.

**W-W1 â€” Dedup webhook YCloud (Effort: S mover / M dedup DB)**
- Estado: `webhooks/ycloud/route.ts:443-449` marca `seenEvents.set` ANTES del switch de procesamiento; un error DB retorna 500 pero el evento ya estÃ¡ marcado â†’ el retry de YCloud recibe `duplicate: true` â†’ pÃ©rdida permanente. `whatsapp_messages.ycloud_message_id` ya es `notNull().unique()` (`schema/whatsapp.ts:103,119-121`) = llave natural de idempotencia.
- Fix mÃ­nimo (2 lÃ­neas): mover el `set` a despuÃ©s del switch exitoso (antes del return 200). El mismo patrÃ³n roto existe en Culqi (`webhooks/culqi/route.ts:213-219`) pero sus handlers son UPDATEs idempotentes â†’ solo YCloud pierde datos hoy.
- Variante durable: columna `ycloud_event_id text unique` + upsert `onConflictDoNothing`, y tabla `webhook_events(event_id PK, processed_at)` para eventos de conversaciÃ³n/channel.

#### Cross-cutting (para el plan de implementaciÃ³n)

1. **Un gate, cuatro blockers**: `requireOwnedBusinessById` (`authz.ts:123`) resuelve C5, C6, W-D1, W-D2 â€” estandarizar `try/catch â†’ 401/throw` como `pay/route.ts:39-47`.
2. **C2 + W-P3 son la misma raÃ­z**: la verdad del dinero del order-flow vive solo en Culqi; la fila `payments` es client-driven. Un helper `getCulqiOrder(orderId, secretKey)` nuevo (espejo de `executeCulqiCharge`) sirve al gate C2, al upsert W-P3 y al cron de conciliaciÃ³n.
3. **C9 toca C1 y W-W1**: toda tabla/columna nueva (policies, `product_id`, `ycloud_event_id`, `webhook_events`, rate_limits) debe ser migraciÃ³n manual idempotente con `--> statement-breakpoint` â€” `drizzle-kit push` PROHIBIDO (README Â§4).
4. **W-W2 + W-W3 + W-I1 comparten archivos** (`whatsappActions.ts`, rutas `connect/*`) â€” hacerlos en un solo change para evitar churn de merge.
5. **RLS (C1) se amplifica con W-P3**: al crear filas `payments` vÃ­a webhook/cron (service role), las policies deben seguir permitiendo el lookup guest por `tracking_token` y la lectura del dashboard del seller â€” si no, rompen tracking y listado de Ã³rdenes el dÃ­a que aterricen.
6. **AUTH_ORIGIN drift**: el fallback `NEXT_PUBLIC_AUTH_ORIGIN` estÃ¡ duplicado en 5+ archivos â€” exportar un helper Ãºnico en `src/shared/utils/url.ts` (fue lo que causÃ³ C3).
7. **Batches sugeridos**: Batch 1 (S, independientes, seguros primero): C5, W-D1, W-D2, C10, C11. Batch 2 (requieren decisiones de producto/env): C3, C4, C6, W-W2. Batch 3 (raÃ­z de dinero, juntos): C2 + W-P3. Batch 4 (datos): C1 + C9 + W-W1 durable.
8. **NingÃºn fix requiere infra nueva** salvo 2 env vars (secret para cookie firmada, `PLATFORM_ADMIN_IDS`) + la decisiÃ³n Redis opcional del rate limiter.

### Anexo B â€” Ref lÃ³gica para no repetir trabajo
- `openspec/changes/whatsapp-coexistence/` â€” trabajo previo de WhatsApp (estado: fixes aplicados y verificados).
- `openspec/specs/plan-enforcement/`, `seller-fraud-guards/`, `payment-orders/` â€” specs relevantes.
- `tasks-pendient/` â€” deuda tÃ©cnica y planes anteriores (incluye `code-security-audit-2026-09-02.md`, `mejora-flujo-culqi.md`).

---

## Historial de cambios

| Fecha | Cambio |
|-------|--------|
| 24/09/2026 | AuditorÃ­a inicial: 5 mÃ³dulos, 11 CRITICAL, checklist de remediaciÃ³n |
| 24/09/2026 | Anexo A: investigaciÃ³n profunda de remediaciÃ³n â€” guÃ­a file-level por hallazgo (patrones a reusar, puntos de inserciÃ³n, esfuerzo S/M/L, riesgos, batches sugeridos) |
| 02/10/2026 | **CorrecciÃ³n de clases (previene re-trabajo sobre cÃ³digo ya resuelto).** C11: ancla eliminada en `f0efd09`, riesgo residual reubicado en `POST /api/order/lookup` (orÃ¡culo 403/404 cross-tenant por slug post-filter) y en la pÃ¡gina `order/verify/[orderNumber]` (**reescalada de Grupo 2 WARNING a Grupo 1 CRITICAL**: sin credencial, sin rate limit, sin cookie gate; disclose Ãºltimos 4 del DNI + carrito + link con `trackingToken`; **impresa en el ticket**). C10: cÃ³digo completo en `5ce5c1f7`; residual â›” dependent de C1 â€” **no tildar**. W-A1 reescalado a Grupo 1 con la premisa **invertida** por C4 (`id` quedÃ³ permanente en `PUBLIC_ORDER_COLUMNS`) + cuarta acciÃ³n no detectada (`confirmFinalization` sin prueba alguna). W-A2: fuga del DNI a history/referrer **confirmada viva** (el cleanup de URL vive en un branch inalcanzable) y quema el rate-limit de la vÃ­ctima; el cruce de chats por DNI ya estÃ¡ neutralizado por R17. **W-N1 nuevo**: Ã³rdenes con `orderNumber = NULL` no tienen ningÃºn path de autenticaciÃ³n funcional. `?dni=`: flujo a borrar, no a prefill. Sin cambios en checkboxes de C2/C4 â€” siguen pendientes de merge. |
