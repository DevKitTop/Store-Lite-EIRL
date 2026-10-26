# PAYMENT INTEGRITY HARDENING PLAN

**Fecha:** 2025-10-24  
**Rama objetivo:** `fix/payment-integrity-server-validation`  
**Base:** `develop` (GitFlow)  
**Objetivo:** Corregir los dos puntos bloqueantes para poder aceptar pagos reales con usuarios externos sin riesgo de manipulación de monto o spoofing vía `culqiOrderId`.

## 1) Contexto

Tras revisar el código actual contra la auditoría externa, se confirma lo siguiente:

- `/api/payment/charge` confía en el `amount` enviado por el cliente. **No recalcula el precio real desde la base de datos.**
- Si llega `culqiOrderId` en el request, el flujo salta directamente a marcar el pago como `paid` **sin verificar contra la API de Culqi**.
- Existen otros riesgos reales (rate-limit en memoria, fallbacks silenciosos en `env.ts`, bypass de firma en webhooks fuera de `production`), pero **NO** son los dos bloqueantes directamente explotables para cobrar menos o marcar pagos falsos.

## 2) Hallazgos validados

| ID        | Hallazgo                                                                                                        | Severidad      | Estado                |
| --------- | --------------------------------------------------------------------------------------------------------------- | -------------- | --------------------- |
| **PI-01** | El monto (`amount`) proviene del cliente y no se compara contra el precio real del producto/carrito en DB.      | **BLOQUEANTE** | Pendiente de corregir |
| **PI-02** | Con `culqiOrderId` se marca `paid` sin llamar a `GET /v2/orders/{id}` para validar estado, monto y pertenencia. | **BLOQUEANTE** | Pendiente de corregir |
| **PI-03** | `rateLimit` + deduplicación de webhooks usan `Map` en memoria (no compartido entre instancias serverless).      | **ALTO**       | Dejar para PR #2      |
| **PI-04** | `src/config/env.ts` usa `console.warn` para secrets críticos en lugar de `throw` en producción.                 | **ALTO**       | Dejar para PR #2      |
| **PI-05** | Webhook de Culqi permite pasar sin firma cuando `NODE_ENV !== 'production'`.                                    | **MEDIO-ALTO** | Dejar para PR #2      |

## 3) Solución propuesta

### PI-01: Validación server-side del monto

**Objetivo:** El servidor debe ser la única fuente de verdad para el precio a cobrar.

**Acciones:**

1. Obtener `product`, `business` y/o `cartItems` desde DB usando `productId`/`businessId` provistos por el request.
2. Calcular `computedAmount` sumando precio real \* cantidad por cada ítem.
3. Validar pertenencia: `product.businessId === businessId` (y cada item debe pertenecer al mismo business).
4. **No confiar en `amount` del cliente.** Comparar con tolerancia **0**. Si hay diferencia -> `400 Bad Request` con mensaje genérico (evitar filtrar detalles internos).
5. Usar **SIEMPRE** `computedAmount` para crear/actualizar `paymentOrders` y para el cobro.
6. Mantener validación con `zod` pero **endurecer con validación de negocio** post-schema.

**Notas:** Si el request trae carrito multi-item, el cálculo debe ser por línea. Si es single-product, recalcular por producto.

### PI-02: Verificación obligatoria con Culqi API cuando llega `culqiOrderId`

**Objetivo:** Eliminar la confianza ciega al cliente. Solo se puede marcar `paid` tras confirmación server-side con Culqi.

**Acciones:**

1. Si `chargeRequestSchema` indica que viene `culqiOrderId` (o se detecta en el body), **interrumpir** el camino "confiar en cliente".
2. Llamar a `GET https://api.culqi.com/v2/orders/{culqiOrderId}` usando `CULQI_SK` del entorno/config.
3. Validar respuesta:
   - `status` === `paid` (o el estado equivalente que Culqi considere pagado)
   - `amount` == `computedAmount` (mismo monto recalculado en PI-01)
   - `currency` esperado (PEN)
   - Pertenencia/coherencia con el negocio/orden si aplica
4. Solo si **TODAS** las validaciones pasan -> proceder a crear/actualizar `payment` y marcar `paymentOrder.status = 'paid'` dentro de la **misma transacción** donde se decrementa stock.
5. Si la verificación falla -> rechazar con `400/422` sin exponer respuesta cruda de Culqi.
6. Añadir logs estructurados **sin** datos sensibles (no loggear números de tarjeta, solo `orderId`, `culqiOrderId`, `businessId`).

**Importante:** El webhook `order.status.changed` sigue siendo válido como mecanismo de reconciliación, pero **el endpoint `/api/payment/charge` NO puede auto-marcar `paid` por el hecho de recibir `culqiOrderId`**.

## 4) Archivos a tocar

| Archivo                                 | Acción                  | Razón                                                                                                                                    |
| --------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `app/api/payment/charge/route.ts`       | **Modificar**           | Núcleo del fix. Mover cálculo de monto a server-side, añadir verificación con Culqi API, reordenar validaciones antes de marcar `paid`.  |
| `src/core/payments/culqiOrders.ts`      | **Modificar / Revisar** | Ya existe lógica relacionada a órdenes Culqi. Añadir helper para `getOrderById`/verificación (`verifyPaidOrder`). Mantener tipado claro. |
| `src/core/payments/saleIdentity.ts`     | **Revisar**             | Validar que siga encajando con los nuevos checks (identity/claim keys).                                                                  |
| `src/core/payments/stockFulfillment.ts` | **Revisar**             | Asegurar que el flujo transaccional sigue correcto tras los nuevos early-returns/rechazos.                                               |
| `tests/unit/chargeRoute.test.ts`        | **Modificar/Ampliar**   | Añadir casos: amount tampering, product/business mismatch, culqiOrderId spoof, monto no coincidente, happy path con verificación.        |
| `tests/unit/culqiOrders.test.ts`        | **Ampliar si aplica**   | Cubrir el nuevo helper de verificación.                                                                                                  |

> **Nota:** Si al implementar vemos que conviene extraer `verifyCulqiOrderPaid(...)` a `src/core/payments/culqiOrderVerification.ts`, lo haremos manteniendo imports limpios.

## 5) Estrategia de implementación

1. **Preparación**
   - `git checkout develop && git fetch origin && git pull origin develop`
   - `git checkout -b fix/payment-integrity-server-validation`
   - Leer `app/api/payment/charge/route.ts` completo + `src/core/payments/culqiOrders.ts` + tests existentes

2. **PI-01 primero**
   - Añadir `SELECT` para obtener precio real por `productId`/`businessId`
   - Calcular `computedAmount`
   - Validar pertenencia y comparación estricta contra `amount`
   - Usar `computedAmount` en todo el flujo

3. **PI-02 después (integrado)**
   - Si `culqiOrderId` presente -> **forzar** verificación con Culqi API antes de marcar `paid`
   - Validar `status`, `amount` vs `computedAmount`, `currency`
   - Rechazar si no coincide o no está `paid`

4. **Hardening menor**
   - Early returns con códigos claros
   - Evitar logs con datos sensibles
   - Mantener idempotencia tal como está

5. **Tests**
   - Actualizar `chargeRoute.test.ts` con los nuevos casos
   - Ajustar mocks para simular respuesta de Culqi API
   - Correr `pnpm test:unit` enfocado a rutas/pagos

## 6) Checklist de verificación

- [ ] **Branch creada** desde `develop` actualizado
- [ ] **PI-01**: Imposible pagar con `amount` menor al precio real
- [ ] **PI-01**: Rechazado si `product.businessId` != `businessId`
- [ ] **PI-02**: Llamada obligatoria a Culqi API cuando hay `culqiOrderId`
- [ ] **PI-02**: Rechazado si Culqi dice distinto estado/monto
- [ ] **PI-02**: Solo se marca `paid` tras verificación OK
- [ ] **Transacción**: Sigue decrementando stock solo en el camino correcto
- [ ] **Idempotencia**: No se rompe con los nuevos checks
- [ ] **Tests unitarios**: `pnpm test:unit` pasa
- [ ] **Quality gate**: `pnpm quality` sin nuevos **errors** (mantener baseline actual)
- [ ] **Revisión diff**: Solo archivos relacionados al hardening
- [ ] **Sin cambios en migraciones/DB schema**

## 7) Riesgos y mitigaciones

| Riesgo                                                  | Impacto   | Mitigación                                                                                                                        |
| ------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Romper flujo existente de checkout (sin `culqiOrderId`) | **MEDIO** | Mantener el camino normal intacto. Solo aplicar PI-02 **únicamente** cuando venga `culqiOrderId`.                                 |
| Diferencia de redondeo con Culqi                        | **BAJO**  | Comparación estricta con valores en centavos/moneda que use el sistema. Si hay conversión, usar la misma fuente (computedAmount). |
| Tests que mockean mal la respuesta de Culqi             | **MEDIO** | Actualizar mocks explícitamente en `chargeRoute.test.ts`. Añadir tests que cubran fallo de verificación.                          |
| Cambios en `chargeRoute` muy extensos                   | **MEDIO** | Ir por pasos: primero PI-01 (compilable + tests), luego PI-02 (integrado con mocks). Commits atómicos.                            |

## 8) Plan post-fix (siguientes PRs)

Una vez mergeado este PR con los dos bloqueantes resueltos, abordaremos en orden:

1. **PR #2 - Infra compartida:** Migrar dedup de webhooks + rate-limit a Redis/Upstash o tabla con `UNIQUE(event_id)`. Añadir protección global entre instancias.
2. **PR #3 - Hardening de config:** Endurecer `env.ts` con `throw` en `production` para secrets críticos. Revisar bypass de firma en `preview`.
3. **PR #4 - Observabilidad:** Añadir métricas/alertas mínimas para rechazos por `amount mismatch` o `culqiOrderId verification failed` (útil para detectar intentos).

## 9) Decisión

**SÍ, vamos con este plan.**

Partimos desde `develop`, creamos `fix/payment-integrity-server-validation`, aplicamos **únicamente** PI-01 + PI-02 en este PR, dejamos el resto para PRs separados y validamos con `test:unit` + `quality` antes de abrir PR.

**Listo para empezar con el branch + implementación.**
