# Flujo de expiración de pedidos por recojo

## Objetivo

Documentar el flujo actual de los pedidos que requieren recojo, los problemas reales de negocio y la opción recomendada para corregirlo con una regla basada en fechas y tiempos persistidos, sin depender únicamente de trabajos programados.

## Estado del problema

El problema confirmado es que el flujo actual del pedido por recojo puede quedarse en un estado de `READY_FOR_PICKUP` durante mucho tiempo si el cliente no retira el producto. La lógica actual intenta resolver esto con timeouts automáticos, pero depende de que un worker o cron se ejecute. Si ese cron no corre, el pedido no expira aunque la regla de negocio exista.

Esto se ve en:

- [src/core/orders/orderTimeouts.ts](../src/core/orders/orderTimeouts.ts)
- [app/api/cron/order-timeouts/route.ts](../app/api/cron/order-timeouts/route.ts)
- [src/features/dashboard/actions/ticketActions.ts](../src/features/dashboard/actions/ticketActions.ts)
- [src/core/orders/orderStateMachine.ts](../src/core/orders/orderStateMachine.ts)

## Flujo actual confirmado

### 1. Compra y pago

El pedido nace en `CREATED` y luego avanza a `PAID`.

Referencia:

- [src/core/orders/orderStateMachine.ts](../src/core/orders/orderStateMachine.ts)

### 2. Preparación y entrega al cliente

Cuando el seller prepara el pedido, el flujo puede avanzar a estados de preparación o, si es un envío, a estados de transporte.

En el caso de recojo, se usa la rama de pickup:

- `PREPARING_ORDER`
- `READY_FOR_PICKUP`
- `PICKED_UP`
- `COMPLETED`

Referencia:

- [src/core/orders/orderStateMachine.ts](../src/core/orders/orderStateMachine.ts)

### 3. Seller marca listo para recoger

La acción que dispara este estado es `markReadyForPickup`:

- [src/features/dashboard/actions/ticketActions.ts](../src/features/dashboard/actions/ticketActions.ts)

Este método hace una transición a `ORDER_STATUS_V2.READY_FOR_PICKUP`.

### 4. Cliente no retira el pedido

Aquí aparece la regla de timeout:

- `pickup-auto-complete`
- `v2Status: READY_FOR_PICKUP`
- `toStatus: COMPLETED`
- `hours: 168` = 7 días

Referencia:

- [src/core/orders/orderTimeouts.ts](../src/core/orders/orderTimeouts.ts)

### 5. Sistema auto-completa

El timeout se ejecuta desde el procesador global de timeouts, que revisa pedidos vencidos y hace `transition(...)` al siguiente estado.

Referencia:

- [src/core/orders/orderTimeouts.ts](../src/core/orders/orderTimeouts.ts)

### 6. Cliente sí retira el pedido

Cuando confirma el código de recojo, la acción `confirmPickedUp` hace:

1. `READY_FOR_PICKUP -> PICKED_UP`
2. luego `PICKED_UP -> COMPLETED` (si el proceso de cierre funciona)

Referencia:

- [src/features/dashboard/actions/ticketActions.ts](../src/features/dashboard/actions/ticketActions.ts)

## Problemas reales detectados

### Problema 1: la regla está acoplada a un cron

La lógica de vencimiento existe, pero no se ejecuta por cálculo de fechas en tiempo real. Se ejecuta por un sweep programado.

Esto implica que el sistema depende del cron para cerrar el pedido. Si el cron falla, se queda en un estado viejo aunque la fecha de vencimiento ya haya pasado.

### Problema 2: la regla no está persistida como deadline explícito

La regla actual no guarda un `pickupExpiresAt` claro y explícito con la fecha exacta de vencimiento. Hay un tiempo relativo (`168h`) pero no la fecha definitiva del evento business.

Esto hace difícil:

- auditoría
- debugging
- reporting
- trazabilidad
- pruebas deterministas

### Problema 3: el usuario puede no saber cuándo realmente vence el pedido

El cliente ve un estado de “por recoger”, pero no tiene una certeza procesable sobre:

- cuándo se activó el tiempo
- cuándo vence
- qué pasa si no recoge
- qué pasa si ya pasó la fecha

### Problema 4: importa si el entorno es prod o local

El proyecto usa cron del entorno de producción para la toma de decisiones. Eso puede dejar el comportamiento inconsistente entre entorno local, staging y producción.

### Problema 5: la lógica del negocio está en un job, no en la entidad del pedido

El negocio dice “si no recoge en 7 días, ese pedido expira”, pero el estado de vencimiento no está definido como dato del pedido mismo. Eso hace que la regla viva fuera del pedido y no en la entidad que la ejecuta.

## Recomendación de diseño

### Regla de negocio recomendada

En lugar de depender solo del cron, el sistema debe guardar una fecha explícita de vencimiento para cada pedido que entra en `READY_FOR_PICKUP`.

Patrón sugerido:

- `readyForPickupAt: Date`
- `pickupExpiresAt: Date`
- `pickupExpiredAt: Date | null`

### Lógica sugerida

Cuando el seller marca `READY_FOR_PICKUP`:

1. guardar `readyForPickupAt = now`
2. guardar `pickupExpiresAt = now + 7 days`
3. actualizar el estado a `READY_FOR_PICKUP`

Luego, en cualquier consulta o en un job backend, hacer:

- si estado es `READY_FOR_PICKUP`
- y `now >= pickupExpiresAt`
- entonces pasar a `COMPLETED` o a un estado de “expirado”

### Beneficios

- deterministic
- auditable
- fácil de mostrar en UI
- no depende de que el cron corra exactamente en el momento correcto
- se puede validar en API y en render

## Rol del cron en el diseño final

El cron sigue siendo útil como respaldo, no como la única fuente de verdad.

La estrategia ideal es:

1. guardar deadline real en la base de datos
2. verificar el estado en render, API o job
3. usar cron como revisor de backfill y limpieza de pedidos viejos

Esto combina estabilidad + claridad.

## Investigacion de servicios / librerias relevantes

### 1. Vercel Cron Jobs

Herramienta útil para jobs programados en producción.

Referencia: https://vercel.com/docs/cron-jobs

Qué ofrece:

- scheduling por cron expresiones
- ejecución HTTP a rutas del proyecto
- buena opción para jobs de limpieza o auto-cierre

Adecuado para:

- limpieza periódica
- worker de timeouts
- revalidaciones de caducidad

No reemplaza la regla de negocio; solo ejecuta la verificación.

### 2. node-cron

Librería de Node para cron expressions.

Referencia: https://www.npmjs.com/package/node-cron

Qué ofrece:

- cron expressions
- overlap prevention
- distributed coordination
- background tasks

Adecuado para:

- tareas recurrentes dentro del backend
- tareas ESPECÍFICAS que deben ejecutarse en un servidor Node

Consideración:

- útil, pero no resuelve por sí sola la lógica de negocio del Pedido
- si se usa, debe ir acompañado de persistencia del deadline

### 3. BullMQ

Queue + delayed jobs + scheduled jobs.

Referencia: https://docs.bullmq.io/

Qué ofrece:

- delayed jobs
- scheduled jobs
- retries
- priorities
- robust queue semantics

Adecuado para:

- jobs de retraso y caducidad
- procesamiento durable de ordenes
- orquestación de procesos de negocio

Ventaja clara:

- más robusto que un cron simple
- mejor para flujo de pedir, ejecutar, reintentar

### 4. Temporal

Workflow durable para procesos críticos.

Referencia: https://docs.temporal.io/

Qué ofrece:

- durable execution
- reintentos/captura de fallos
- seguimiento de workflows
- robustez para procesos de negocio

Adecuado para:

- flujos críticos de e-commerce
- procesos de checkout, entrega, recuperación, disputas
- sistemas donde la lógica no puede perderse tras crash o deploy

Conclusión:

- es la opción más robusta, pero probablemente es más pesada de implementar que lo que el proyecto necesita hoy

## Conclusión práctica para este proyecto

No parece que exista un servicio “mágico” para este caso. La solución real suele ser una combinación de:

1. una fecha persistida de vencimiento
2. una validación en API/render
3. un job programado como respaldo para limpieza y corrección en background

Para este proyecto, la decisión más sensata es:

- no depender únicamente de cron
- guardar `pickupExpiresAt` cuando el seller marque `READY_FOR_PICKUP`
- evaluar vencimiento con `now >= pickupExpiresAt`
- mantener un cron o worker para detectar registros atrasados

## Recomendación final

Se debe implementar la solución como una regla de negocio explícita, no como un efecto colateral del cron.

El cron ayuda a ejecución, pero la fuente de verdad debe ser la fecha del pedido.

## Tareas pendientes para el siguiente paso

1. definir el campo exacto en la base de datos
2. decidir el nombre del status final a usar (`COMPLETED` vs `EXPIRED`)
3. decidir si se usa `pickupExpiresAt` o `deadlineAt` general
4. definir si la evaluación se hace en API + UI + cron
5. preparar el diseño técnico y luego el patch real

## Evidencia principal del código

- [src/core/orders/orderTimeouts.ts](../src/core/orders/orderTimeouts.ts)
- [app/api/cron/order-timeouts/route.ts](../app/api/cron/order-timeouts/route.ts)
- [src/features/dashboard/actions/ticketActions.ts](../src/features/dashboard/actions/ticketActions.ts)
- [src/core/orders/orderStateMachine.ts](../src/core/orders/orderStateMachine.ts)
- [src/features/dashboard/actions/finalizationActions.ts](../src/features/dashboard/actions/finalizationActions.ts)
