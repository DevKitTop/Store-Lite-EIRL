# Order Notifications & Real-Time Timers

> ⏰ **Documento de planificación** — Pendiente de implementar.
> Creado: 26/06/2026

## Objetivo

Sistema de notificaciones en tiempo real y temporizadores visibles para que el seller tenga visibilidad completa de sus plazos por pedido, y el cliente reciba actualizaciones proactivas.

---

## ¿Qué falta hoy?

- El sistema de notificaciones existe (tabla `notifications`, funciones helper en `src/lib/notifications.ts`) pero NO está conectado al flujo de pedidos
- No hay temporizador visual en el dashboard del seller
- El cron de timeouts (`processTimeouts`) solo ejecuta transiciones, no notifica

---

## Lo que hay que construir

### 1. Notificaciones automáticas conectadas al flujo

Disparar notificaciones desde `orderService.transition()` y desde `processTimeouts()`:

**Para el Seller:**
| Evento | Tipo | Mensaje |
|--------|------|---------|
| Nuevo pedido pagado | `order_created` | "Nuevo pedido de [cliente] — S/120.00" |
| Cliente confirmó información | `order_status_changed` | "[Cliente] confirmó la información de envío" |
| Cliente reportó problema | `order_status_changed` | "[Cliente] reportó un problema con el pedido" |
| 24h sin preparar (alerta) | `order_status_changed` | "⚠️ Te quedan 24h para preparar el pedido [NRO]" |
| 48h — multa aplicada | `order_status_changed` | "🔴 Multa aplicada por demora — S/[monto]" |
| Pedido completado | `order_status_changed` | "Pedido [NRO] completado — S/[monto] liberado" |
| Límite de multas alcanzado | `system` | "🚫 Pasarela de pagos bloqueada por multas pendientes" |

**Para el Cliente:**
| Evento | Mensaje |
|--------|---------|
| Pedido pagado | "Tu pago fue recibido. El vendedor está preparando tu pedido" |
| Seller no prepara (48h) | "El vendedor está demorando la preparación. Recibirás una compensación." |
| Pedido en tránsito | "Tu pedido está en camino" |
| Pedido completado | "Pedido completado. Gracias por tu compra" |

### 2. Temporizador visual en el dashboard

En el `OrderModal` o en la tabla de pedidos, mostrar un countdown:

```
PREPARANDO PEDIDO
⏱️  Te quedan 23:45:12 para preparar este pedido
```

**Consideraciones técnicas:**

- Usar `useEffect` con `setInterval` del lado del cliente
- Calcular el deadline desde `createdAt + 48h`
- Si ya pasó el deadline: mostrar "🔴 ATRASADO — Multa de S/[monto] aplicada"
- Actualizar en tiempo real (no requiere websockets, el countdown es puramente frontend)

### 3. Notificaciones en tiempo real

Para notificaciones push sin recargar la página:

- Opción A: **Polling** (cada 30s el dashboard consulta `/api/notifications/unread-count`)
- Opción B: **Server-Sent Events** (más eficiente, pero más complejo)
- Opción C: **WebSockets** (con Socket.io o similar)

Recomendación: empezar con **Polling** (ya existe la ruta `/api/notifications/unread-count`), migrar a SSE después.

### 4. Arquitectura propuesta

```
orderService.transition()
  → actualiza estado (ya existe)
  → registra timeline event (ya existe)
  → llama notifyOrderStatusChange() (NUEVO)

processTimeouts()
  → procesa orders vencidas (ya existe)
  → registra penalty/late event (NUEVO)
  → notifica al seller (NUEVO)

Dashboard frontend:
  → poll cada 30s: GET /api/notifications/unread-count
  → muestra contador en NotificationBell
  → muestra countdown en OrderModal
```

### 5. Dependencias

- El sistema de multas/penalidades debe existir primero (ver `ORDER_PENALTY_SYSTEM.md`)
- La tabla `notifications` ya existe en la DB
- Las rutas API de notifications ya existen
- Solo falta conectar los disparadores

---

## Prioridad

- **Alta**: Conectar notificaciones al orderService + processTimeouts
- **Media**: Countdown visual en el dashboard
- **Baja**: Tiempo real con SSE/WebSockets
