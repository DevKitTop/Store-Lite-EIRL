# Order Dispute & Issue Resolution System

> ⚖️ **Documento de planificación** — Pendiente de implementar.
> Creado: 26/06/2026

## Objetivo

Sistema completo de manejo de incidencias y disputas para pedidos, permitiendo que cliente y seller resuelvan problemas sin escalar, y que la plataforma tenga un proceso de arbitraje cuando sea necesario.

---

## Estado actual

### Lo que YA existe

- **Máquina de estados**: `ISSUE_REPORTED` y `DISPUTE` están modelados
- **Transiciones permitidas**:

  ```
  WAITING_CUSTOMER_CONFIRMATION ──► ISSUE_REPORTED
  READY_TO_SHIP ──► ISSUE_REPORTED
  IN_TRANSIT ──► ISSUE_REPORTED
  DELIVERED ──► ISSUE_REPORTED
  READY_FOR_PICKUP ──► ISSUE_REPORTED
  PICKED_UP ──► ISSUE_REPORTED

  ISSUE_REPORTED ──► DISPUTE
  ISSUE_REPORTED ──► READY_TO_SHIP
  ISSUE_REPORTED ──► DELIVERED
  ISSUE_REPORTED ──► CANCELLED
  ```

- **DISPUTE es terminal**: `to: []` — no se puede resolver

### Lo que falta

- ❌ UI para que el cliente reporte un problema con motivos
- ❌ UI para que el seller vea y responda issues
- ❌ Mecanismo de resolución de DISPUTE
- ❌ Panel de admin para arbitrar disputas
- ❌ Evidencia (mensajes, attachments) durante la disputa

---

## Flujo propuesto

### ISSUE_REPORTED (Problema reportado)

```
1. Cliente hace clic en "Reportar problema"
2. Selecciona motivo:
   - INVALID_TRACKING: Tracking inválido
   - INCORRECT_COST: Costo de envío incorrecto
   - MISSING_INFORMATION: Falta información
   - WRONG_DOCUMENT: Documento incorrecto
   - OTHER: Otro
3. Agrega descripción (obligatorio)
4. Adjunta evidencia (opcional, max 3 archivos)
5. Sistema: registra timeline event + notifica al seller
```

**Resolución:**

- Seller corrige el problema → el issue se cierra y el flujo continúa
- Seller no responde en 48h → el issue escala automáticamente a DISPUTE
- Cliente puede escalar manualmente a DISPUTE en cualquier momento

### DISPUTE (Disputa formal)

```
1. Escalación desde ISSUE_REPORTED (manual o por timeout)
2. Requiere:
   - Motivo formal
   - Descripción detallada
   - Evidencia completa
   - Registro de timeline
3. El pedido se PAUSA — no hay transiciones automáticas
4. Admin de Store Lite revisa el caso
```

**Resolución (admin):**
| Decisión | Acción |
|----------|--------|
| A favor del cliente | Cancelar pedido + devolución 100% |
| A favor del seller | Continuar flujo (READY_TO_SHIP o DELIVERED) |
| Dividido | Devolución parcial (ej: 50%) |

### Interfaz de Admin

Panel simple donde el admin ve:

- Pedidos en ISSUE_REPORTED y DISPUTE
- Evidencia adjunta
- Timeline de eventos
- Chat entre cliente y seller (si existe)

Puede:

- Resolver a favor del cliente
- Resolver a favor del seller
- Enviar mensaje a ambas partes

---

## Implementación

### Fase 1: ISSUE_REPORTED (UI básica)

- Botón "Reportar problema" en la vista del cliente (`/order/[token]`)
- Selector de motivos + descripción + adjuntar evidencia
- Notificación al seller
- Seller puede revisar y cerrar el issue desde el dashboard

### Fase 2: DISPUTE (Admin panel)

- Cuando el issue escala, el admin recibe notificación
- Panel de admin para ver el caso completo
- Botones de resolución (a favor de quién)

### Fase 3: Automatización

- Timeout de ISSUE_REPORTED (48h sin respuesta → DISPUTE automático)
- Timeout de DISPUTE (7 días sin resolución → regla por defecto)
- Reportes de disputas por seller

---

## Dependencias

- Sistema de notificaciones (ver `ORDER_NOTIFICATIONS_TIMERS.md`)
- Sistema de penalidades al seller (ver `ORDER_PENALTY_SYSTEM.md`)
- Sistema de devoluciones/reembolsos (Culqi)

---

## Prioridad

- **Alta**: Botón de reporte de problema para el cliente
- **Alta**: Notificación al seller cuando hay issue
- **Alta**: Que DISPUTE no sea terminal (que se pueda resolver)
- **Media**: Panel de admin para arbitrar
- **Baja**: Automatización de timeouts en issues
