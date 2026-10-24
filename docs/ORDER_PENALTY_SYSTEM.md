# Order Penalty System â€” Seller Fulfillment SLA

> ðŸš¨ **Plan de implementaciÃ³n** â€” Simple y directo.
> Creado: 26/06/2026 â€” v3 (final)

## FilosofÃ­a

Store Lite es un SaaS, no un banco ni un seguro. La responsabilidad legal de la transacciÃ³n es del **vendedor (negocio)**, no de la plataforma.

**Al customer se le advierte antes de comprar:**

> "VerificÃ¡ que la tienda sea confiable. Store Lite no se responsabiliza por estafas â€” la ley caerÃ­a sobre el negocio."

**Store Lite protege su ecosistema:**

- Detecta y penaliza sellers que no cumplen
- Bloquea su capacidad de recibir nuevos pagos
- Cierra negocios reincidentes permanentemente

## Tipos de Multa

Cada multa tiene un registro completo con tÃ­tulo, tipo, descripciÃ³n, monto y estado.
El seller puede ver el historial completo en "Mis Multas".

### Multa Tipo A â€” Incumplimiento de plazo (dÃ­a 6)

| Campo                | Valor                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| **TÃ­tulo**          | `INCUMPLIMIENTO_PLAZO_PREPARACION`                                                                             |
| **DescripciÃ³n**     | "No preparaste el pedido [NRO] dentro del plazo de 5 dÃ­as. Como resultado, se bloqueÃ³ tu pasarela de pagos." |
| **CÃ¡lculo**         | 5% del valor del producto (mÃ­n S/5)                                                                           |
| **CuÃ¡ndo**          | DÃ­a 6 automÃ¡ticamente                                                                                        |
| **Efecto adicional** | ðŸš« Culqi bloqueado                                                                                           |
| **Desbloqueo**       | Pagar la multa â†’ Culqi se reactiva                                                                           |

### Multa Tipo B â€” Abandono de pedido (dÃ­a 10)

| Campo                | Valor                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **TÃ­tulo**          | `ABANDONO_PEDIDO`                                                                                          |
| **DescripciÃ³n**     | "Abandonaste el pedido [NRO] por mÃ¡s de 10 dÃ­as sin procesarlo. El negocio fue cerrado permanentemente." |
| **CÃ¡lculo**         | **10% del valor del producto** (mÃ­n S/10) â€” es adicional a la multa Tipo A                              |
| **CuÃ¡ndo**          | DÃ­a 10 automÃ¡ticamente                                                                                   |
| **Efecto adicional** | ðŸ”’ **Negocio cerrado permanentemente** (asociado al RUC)                                                 |
| **Reapertura**       | No aplica. El RUC queda marcado como `blacklisted` en la plataforma.                                       |

Si un seller quiere apelar, el customer recibiÃ³ el mensaje de que el negocio estÃ¡ siendo investigado.
Store Lite puede revisar el caso manualmente, pero la regla por defecto es **cierre definitivo**.

---

## Reglas

- **DÃ­as 1-5**: Seller prepara el pedido (normal)
- **DÃ­a 6**: ðŸš« Bloqueo Culqi + ðŸ’° Multa Tipo A (5%)
- **DÃ­a 10**: ðŸ”’ Cierre del negocio + ðŸ’° Multa Tipo B (10%)
- El flujo del pedido NUNCA se detiene
- Pagar multa â†’ desbloqueo Culqi
- 3+ pedidos con multa en 30 dÃ­as â†’ bloqueo automÃ¡tico

---

## Estados que cuentan para el seller

| Estado                      | LÃ­mite      | Â¿QuÃ© hace el seller acÃ¡?          |
| --------------------------- | ------------ | ------------------------------------ |
| `PREPARING_ORDER`           | MÃ¡x 2 dÃ­as | Prepara el producto, sube ticket     |
| `READY_TO_SHIP` (delivery)  | MÃ¡x 2 dÃ­as | EnvÃ­a el paquete, registra tracking |
| `READY_FOR_PICKUP` (recojo) | MÃ¡x 2 dÃ­as | Marca como listo para recojo         |

**Total mÃ¡ximo: 5 dÃ­as.** Si suma mÃ¡s de 5 dÃ­as en estos estados â†’ bloqueo + multa.

### Estados que NO cuentan (fuera del control del seller)

| Estado                          | QuiÃ©n controla                                  |
| ------------------------------- | ------------------------------------------------ |
| `WAITING_CUSTOMER_CONFIRMATION` | Cliente (2 dÃ­as sin respuesta â†’ auto-aprueba) |
| `IN_TRANSIT`                    | Courier                                          |
| `DELIVERED`                     | Courier / Cliente                                |
| `PICKED_UP â†’ COMPLETED`       | Sistema (72h auto-completa)                      |

---

## CÃ¡lculo de multas

| Tipo                               | CuÃ¡ndo | Multa                                                                | Ejemplo (S/120)       |
| ---------------------------------- | ------- | -------------------------------------------------------------------- | --------------------- |
| `INCUMPLIMIENTO_PLAZO_PREPARACION` | DÃ­a 6  | **5% del valor del producto** (mÃ­n S/5)                             | **S/6.00**            |
| `ABANDONO_PEDIDO`                  | DÃ­a 10 | **10% del valor del producto** (mÃ­n S/10) â€” se suma a la anterior | **S/12.00** adicional |

**Ejemplo completo:** Producto de S/120.00

- Multa Tipo A (dÃ­a 6): S/6.00
- Multa Tipo B (dÃ­a 10): S/12.00
- **Deuda total: S/18.00**

Si el seller paga la Tipo A en el dÃ­a 7, Culqi se desbloquea. Si luego abandona el pedido hasta el dÃ­a 10 igual se aplica la Tipo B + cierre del negocio.

---

## Bloqueo Culqi

### Â¿CuÃ¡ndo?

- **DÃ­a 6** automÃ¡ticamente si el pedido sigue en PREPARING_ORDER, READY_TO_SHIP o READY_FOR_PICKUP
- TambiÃ©n si acumula **3+ pedidos con multa en 30 dÃ­as**

### Â¿QuÃ© afecta?

| AcciÃ³n                        | Â¿Permitida? |
| ------------------------------ | :----------: |
| Procesar NUEVOS pagos (Culqi)  |      âŒ      |
| Gestionar pedidos EXISTENTES   |      ✅      |
| Dashboard, productos, almacÃ©n |      ✅      |
| Pagar multas                   |      ✅      |

### Â¿CÃ³mo se desbloquea?

1. Seller va a **"Mis Multas"** en el dashboard
2. Ve las multas pendientes
3. Paga con Culqi (tarjeta, Yape, Plin)
4. AutomÃ¡tico: paga â†’ `culqi_blocked = false`
5. Si reincide â†’ se bloquea de nuevo

---

## Customer experience

### Antes de comprar

Advertencia visible en la tienda (checkout / perfil del negocio):

> âš ï¸ **VerificÃ¡ que esta tienda sea confiable.** Store Lite no se responsabiliza por transacciones entre usuarios. La responsabilidad legal recae en el negocio.

### Durante el pedido

| SituaciÃ³n                    | Mensaje para el customer                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Seller preparando (dÃ­as 1-5) | ðŸŸ¢ "El vendedor estÃ¡ preparando tu pedido"                                         |
| Seller atrasado (dÃ­a 6+)     | ðŸ”´ "El vendedor no cumpliÃ³ con el plazo. La plataforma ha tomado acciones."        |
| Negocio cerrado (dÃ­a 10+)    | âŒ "El vendedor y su negocio estÃ¡n siendo investigados. El pedido queda finalizado." |

---

## Flujo visual para cada tipo de pedido

### Delivery

```
PAID â”€â”€2dâ”€â”€â–º PREPARING_ORDER â”€â”€2dâ”€â”€â–º WAITING_CUSTOMER_CONFIRMATION â”€â”€â–º READY_TO_SHIP â”€â”€2dâ”€â”€â–º IN_TRANSIT
                                          â”‚ (cliente auto-aprueba)                        â”‚ (courier)
                                          â””â”€â”€ 2d sin respuesta â†’ auto âœ“                  â””â”€â”€ sin lÃ­mite

DÃA 1 â—„â”€â”€â–º DÃA 3 â—„â”€â”€â–º DÃA 5 â—„â”€â”€â–º DÃA 6 â†’ ðŸš« BLOQUEO CULQI + ðŸ’° MULTA A (5%)
                                  â””â”€â”€â–º DÃA 10 â†’ ðŸ”’ CIERRE + ðŸ’° MULTA B (10%)
```

### Recojo

```
PAID â”€â”€2dâ”€â”€â–º PREPARING_ORDER â”€â”€2dâ”€â”€â–º READY_FOR_PICKUP â”€â”€â–º PICKED_UP â”€â”€72hâ”€â”€â–º COMPLETED

DÃA 1 â—„â”€â”€â–º DÃA 3 â—„â”€â”€â–º DÃA 5 â—„â”€â”€â–º DÃA 6 â†’ ðŸš« BLOQUEO CULQI + ðŸ’° MULTA A (5%)
                                  â””â”€â”€â–º DÃA 10 â†’ ðŸ”’ CIERRE + ðŸ’° MULTA B (10%)
```

---

## Flag en la BD

Columna nueva en `businesses`:

```sql
culqi_blocked  boolean DEFAULT false     -- bloquea nuevos pagos
penalty_debt   numeric(10,2) DEFAULT 0   -- deuda total pendiente
```

Tabla nueva `penalties`:

```sql
id                uuid PK
business_id       uuid FK â†’ businesses
order_id          uuid FK â†’ payments

-- IdentificaciÃ³n de la multa
penalty_type      text NOT NULL  -- 'INCUMPLIMIENTO_PLAZO_PREPARACION' | 'ABANDONO_PEDIDO'
title             text NOT NULL  -- TÃ­tulo legible: "Incumplimiento de plazo de preparaciÃ³n"
description       text NOT NULL  -- DescripciÃ³n detallada de por quÃ© se aplicÃ³

-- Monto
amount            numeric(10,2) NOT NULL  -- Monto de la multa
percentage        numeric(5,2)            -- Porcentaje aplicado (ej: 5.00, 10.00)
product_value     numeric(10,2)           -- Valor del producto sobre el que se calculÃ³

-- Estado
status            text NOT NULL DEFAULT 'pending'  -- pending | paid | cancelled | disputed
paid_at           timestamptz                      -- CuÃ¡ndo pagÃ³
payment_method    text                             -- 'culqi', 'manual'
payment_id        text                             -- ID de la transacciÃ³n Culqi si aplica

-- Metadata
order_number      text                             -- NRO de orden legible (SL-XXXX)
created_at        timestamptz DEFAULT now()
resolved_at       timestamptz                      -- CuÃ¡ndo se resolviÃ³ (pagÃ³, cancelÃ³, etc.)
notes             text                             -- Notas internas del admin si aplica
```

---

## Resumen de cambios tÃ©cnicos

### Fase 1 â€” Schema + DB

1. Agregar columnas a `businesses`: `culqi_blocked boolean`, `penalty_debt numeric`, `penalty_count integer`, `blacklisted boolean`, `blacklisted_at timestamptz`
2. Crear tabla `penalties` con todos los campos (title, type, description, amount, percentage, etc.)

### Fase 2 â€” Timeout processor

3. Modificar `processTimeouts()` para que evalÃºe **dos reglas**:
   - **Regla A (dÃ­a 6)**: si order en PREPARING_ORDER/READY_TO_SHIP/READY_FOR_PICKUP por +5 dÃ­as â†’ crear `penalty_type: 'INCUMPLIMIENTO_PLAZO_PREPARACION'` + `culqi_blocked = true`
   - **Regla B (dÃ­a 10)**: si la multa A sigue sin pagarse y el pedido sigue sin avanzar o el seller no paga â†’ crear `penalty_type: 'ABANDONO_PEDIDO'` + `blacklisted = true` + cierre del negocio
4. El pedido **NUNCA cambia de estado** â€” el flujo del pedido sigue vivo

### Fase 3 â€” Middleware Culqi

5. En el proceso de pago (Culqi), validar `business.culqi_blocked` antes de crear una transacciÃ³n
6. Si estÃ¡ bloqueado, rechazar con mensaje: "Tu pasarela de pagos estÃ¡ bloqueada. PagÃ¡ tus multas pendientes en Dashboard > Mis Multas."

### Fase 4 â€” Endpoints

7. `GET /api/business/penalties` â€” lista de multas del negocio (con filtros: pending, paid, all)
8. `POST /api/business/penalties/pay` â€” pagar una o varias multas con Culqi
9. `GET /api/business/penalty-status` â€” estado actual (blocked, debt, can_sell)

### Fase 5 â€” Frontend

10. PÃ¡gina "Mis Multas" en `/dashboard/penalties` con tabla completa de multas
11. Modal de pago con Culqi integrado
12. Indicador de atraso en OrderModal (seller) con countdown
13. Badge de reputaciÃ³n / advertencia en tiendas (customer)
14. Mensajes al customer segÃºn estado del pedido

---

## Plan de ImplementaciÃ³n â€” Tareas Secuenciales

> ✅ = Completada | ⬜ = Pendiente | ðŸ”„ = En progreso

### Dependencias

```
T1 â”€â”€â–º T2 â”€â”€â–º T3 â”€â”€â–º T4 â”€â”€â–º T5
                    â”‚
                    â””â”€â”€â”€â”€â–º T6 â”€â”€â–º T7 â”€â”€â–º T8
                              â”‚
                              â””â”€â”€â”€â”€â–º T9
                    â””â”€â”€â”€â”€â–º T10

T11 corre en paralelo despuÃ©s de T4/T5/T6/T7
```

---

### T1 â€” Schema: Agregar columnas a `businesses`

**QuÃ©**: Agregar 5 columnas a `businesses`:

- `culqi_blocked boolean DEFAULT false` â€” bloquea nuevos pagos
- `penalty_debt numeric(10,2) DEFAULT 0` â€” deuda total pendiente
- `penalty_count integer DEFAULT 0` â€” cantidad de multas activas
- `blacklisted boolean DEFAULT false` â€” negocio marcado para cierre
- `blacklisted_at timestamptz` â€” cuÃ¡ndo se marcÃ³

**Archivos**: `src/core/database/schema/businesses.ts` + migraciÃ³n Drizzle

**Check**: ✅

---

### T2 â€” Schema: Crear tabla `penalties`

**QuÃ©**: Tabla nueva con todos los campos definidos arriba.

**Archivos**: `src/core/database/schema/penalties.ts` (nuevo) + migraciÃ³n

**Check**: ✅

---

### T3 â€” Tipos y constantes de penalidades

**QuÃ©**: Archivo de tipos compartidos:

- Enum/types para `PenaltyType`, `PenaltyStatus`
- Constantes: `PENALTY_A_PERCENTAGE = 5`, `PENALTY_B_PERCENTAGE = 10`
- Constantes: `SELLER_TIMEOUT_DAYS = 5`, `ABANDONO_DAYS = 10`
- Interfaz `PenaltyRecord` completa

**Archivos**: `src/core/penalties/penaltyTypes.ts`

**Check**: ✅

---

### T4 â€” Modificar `orderTimeouts.ts`

**QuÃ©**: El cron de timeouts deja de transicionar a `SELLER_TIMEOUT`. En su lugar:

- **Regla A (dÃ­a 6)**: Si order lleva +5 dÃ­as en PREPARING_ORDER/READY_TO_SHIP/READY_FOR_PICKUP â†’ crear penalidad Tipo A + `culqi_blocked = true`
- **Regla B (dÃ­a 10)**: Si sigue sin avance +10 dÃ­as â†’ crear penalidad Tipo B + `blacklisted = true`
- El pedido **NUNCA cambia de estado**

**Archivos**: `src/core/orders/orderTimeouts.ts`

**Check**: ✅

---

### T5 â€” State Machine: `SELLER_TIMEOUT` ya no es destino

**QuÃ©**: Eliminar o desactivar `SELLER_TIMEOUT` como transiciÃ³n desde `PREPARING_ORDER`. El estado puede quedar para pedidos legacy, pero no debe usarse para nuevos.

**Archivos**: `src/core/orders/orderStateMachine.ts`

**Check**: ✅

---

### T6 â€” Middleware Culqi

**QuÃ©**: Validar `business.culqi_blocked` antes de procesar nuevos pagos. Si bloqueado â†’ rechazar con mensaje claro.

**Archivos**: Donde se procesan pagos Culqi (identificar punto exacto)

**Check**: ✅

---

### T7 â€” Endpoints API de penalidades

**QuÃ©**: Tres endpoints:

1. `GET /api/business/penalties?status=pending` â€” listar multas
2. `POST /api/business/penalties/pay` â€” pagar con Culqi
3. `GET /api/business/penalty-status` â€” estado del negocio

**Archivos**: Nuevos en `app/api/business/penalties/`

**Check**: ✅

---

### T8 â€” Frontend: PÃ¡gina "Mis Multas"

**QuÃ©**: PÃ¡gina en dashboard (`/dashboard/penalties`):

- Tabla de multas con tipo, tÃ­tulo, descripciÃ³n, monto, fecha, estado
- Badge de estado (rojo/verde/gris)
- BotÃ³n "Pagar todo" con modal Culqi
- Banner de bloqueo si aplica

**Archivos**: `app/[slug]/dashboard/penalties/page.tsx` + componentes + CSS

**Check**: ✅

---

### T9 â€” Frontend: Customer warnings

**QuÃ©**:

- Antes de comprar: advertencia en checkout si el negocio tiene multas
- Durante el pedido: mensaje en `/order/[token]` si el seller estÃ¡ atrasado

**Archivos**: Checkout + `app/[slug]/order/[token]/page.tsx`

**Check**: ✅

---

### T10 â€” Frontend: Indicador de atraso (seller)

**QuÃ©**: En `OrderModal`, cuando el pedido estÃ¡ en PREPARING_ORDER:

- Countdown: "â±ï¸ Te quedan X dÃ­as y X horas"
- Si atrasado: "ðŸ”´ ATRASADO â€” Multa de S/X.XX"

**Archivos**: `app/[slug]/dashboard/components/OrderModal.tsx`

**Check**: ✅

---

### T11 â€” Testing

**QuÃ©**: Tests unitarios y de integraciÃ³n para todo el sistema de penalidades.

**Archivos**: `tests/unit/` (nuevos)

**Check**: ⬜
