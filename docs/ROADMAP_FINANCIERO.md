# 📈 Roadmap Financiero - Store Lite

> Documento de planificación para modelos de ingresos futuros.
> Última actualización: Abril 2026

---

## Estado Actual: ✅ Implementado

### Planes de Suscripción (ACTUAL)

- **Modelo**: Pago mensual/anual por usar la plataforma
- **Planes**: Básico (Gratis), Emprendedor (S/59), Business Pro (S/99), Enterprise AI (S/149) — precios finales con IGV incluido
- **Gestión**: Desde base de datos, fecha de vigencia + vencimiento
- **Tecnología**: Sin Culqi Subscriptions - se maneja manualmente
- **Status**: ✅ Funcionando

---

## Estado: 🔄 Para Futuro (Post-MVP)

### 1. Split Payments / Marketplace

**Descripción**: Cobrar 10% de cada venta de los negocios automáticamente.

**Cómo funciona**:

```
Cliente paga S/100 → Culqi split:
  - 10% (S/10) → Store Lite
  - 85.9% (S/85.90) → Negocio
  - 4.1% (S/4.10) → Comisión Culqi
```

**Requisitos técnicos**:

```json
{
  "source_id": "tkn_...",
  "transfer_data": {
    "destination_id": "mcht_XXXXX",
    "amount": 9000
  }
}
```

**Estado legal actual**:

- ❌ No disponible para Persona Natural
- ✅ Requiere empresa constituida (SAC, SRL, etc.)
- ⏳ Requiere activación de perfil Marketplace en Culqi

**Pendiente**:

- [ ] Contactar a Culqi para activar perfil Marketplace
- [ ] Cuando sea empresa constituida
- [ ] Implementar código (preparado en docs/CULQI_MARKETPLACE_WORKFLOW.md)

---

### 2. Sistema de Renovación de Planes

**Descripción**: Notificaciones automáticas cuando el plan está por vencer.

**Funcionalidades**:

- [ ] Banner de "Plan por vencer" 7 días antes
- [ ] Email de recordatorio
- [ ] Proceso de renovación sin fricción
- [ ] Grace period antes de desactivar funcionalidades

**Tecnología**:

- Cron job o Edge Function que verifique fechas diarias
- Email via Supabase o servicio externo

---

### 3. Sistema de Pause/Suspensión

**Descripción**: Manejo elegante cuando el pago falla o el usuario no renueva.

**Flujo**:

1. Pago falla → Notificación + retry automático
2. Vence → Período de gracia (3 días)
3. Suspensión → Solo lectura (no ventas)
4. Reactivación → Pago + restauración inmediata

---

### 4. Facturación Electrónica SUNAT

**Descripción**: Emitir comprobantes oficiales (facturas/boletas) validados por SUNAT.

**Por qué es importante**:

- SUNAT exige que todas las ventas tengan comprobantes electrónicos
- Los clientes (especialmente empresas) exigen factura oficial para deducir IGV

**Cómo funciona**:

```
Generar JSON → Firmar con certificado → Enviar a OSE/SUNAT → CDR (validados)
```

**Requisitos**:

- OSE (Operador de Servicios Electrónicos) como APISUNAT
- Certificado digital de empresa
- Cuenta en portal de SUNAT

**Alternativas**:
| Servicio | Costo aproximado | Difficulty |
|----------|-----------------|------------|
| APISUNAT | ~S/20-50/mes | Fácil |
| iGEA ERP | ~S/50+/mes | Medio |
| Integración directa | Bajo pero complejo | Difícil |

**Estado actual**:

- ⏳ No es necesario ahora - tickets actuales son internos
- ✅ Para cuando un negocio lo solicite específicamente

**Pendiente**:

- [ ] Solo implementar cuando un cliente lo demande
- [ ] Investigar costos de OSE cuando sea necesario

---

### 5. Dominio Propio + SEO Competitivo (tier premium)

**Descripción**: permitir que cada seller conecte su propio dominio
(`mitienda.com`) y ofrecer SEO competitivo como add-on pago. El storefront ya
tiene la base técnica (canonical, sitemap, JSON-LD, OG images) pensada como
**higiene gratuita para todos**; lo que se vende arriba es la **competitividad**.

**Hallazgo técnico clave**: NO hace falta infra por tienda. Una sola app en
Vercel soporta custom domains por proyecto; el dominio se resuelve y se
reescribe en `proxy.ts` al slug correspondiente. El costo real es **operativo**
(verificación DNS, SSL, soporte al seller), no de hosting.

**Ventaja competitiva**: es el feature que Shopify/Wix cobran caro y el
escalón que convierte al seller de "probador" a "pagador del tier caro".

**Detalle completo**: ver

- `docs/roadmap/custom-domains-premium.md`
- `docs/roadmap/seo-competitivo.md`

---

## Decisiones Tomadas

| Tema                       | Decisión                              | Fecha    |
| -------------------------- | ------------------------------------- | -------- |
| Suscripciones con Culqi    | ❌ No necesario - manejar desde BD    | Abr 2026 |
| Split Payments             | ⏳ Postergado para cuando sea empresa | Abr 2026 |
| Facturación SUNAT          | ⏳ Solo cuando un cliente lo demande  | Abr 2026 |
| Modelo de ingresos inicial | Solo planes de suscripción            | Abr 2026 |
| SEO: higiene técnica       | ✅ Gratis para todos (core)           | Ago 2026 |
| SEO: competitivo + dominio | ⏳ Tier premium futuro                | Ago 2026 |

---

## Notas Importantes

- **No es urgencia**: El enfoque actual debe ser conseguir negocios, no complejidad financiera
- **Tickets actuales**: Son comprobantes internos, no facturas oficiales SUNAT
- **Split Payments**: Ver `docs/CULQI_MARKETPLACE_WORKFLOW.md` para detalles técnicos
- **Facturación SUNAT**: Investigar cuando un negocio lo solicite formalmente

---

_Documento vivo - Actualizar cuando haya cambios en el roadmap_
