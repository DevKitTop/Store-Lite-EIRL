# Ficha de Plan — Dominio Propio por Seller (Premium)

> **Feature:** el seller conecta su propio dominio (`mitienda.com`) a su
> storefront, en lugar del subdominio por defecto (`mitienda.storelite.app`).
> **Estado:** Idea registrada. **Prioridad:** Alta — es el diferenciador más
> fuerte y vendible de toda la plataforma.
> **Registrado:** 2026-08-31

---

## Qué es / Por qué importa

Un negocio que quiere competir seriamente **necesita su propio dominio**:

- Transmite marca y confianza (`mitienda.com` > `mitienda.storelite.app`).
- Mejora el SEO (los dominios con marca rankean mejor que un subdominio ajeno).
- Es el feature que Shopify/Wix cobran caro por exactamente esto.

Es el **escalón premium** natural del funnel: el subdominio es «gratis y
funciona», el dominio propio es «pagá para crecer».

---

## Lo que la gente cree (y está mal)

> "Cada tienda tendría su propio Vercel / su propia infra → complejo y caro."

**Falso.** No hace falta un deploy ni una infra por tienda:

- **Una sola app** desplegada en Vercel (la actual). No cambia.
- El dominio propio es **solo DNS + un rewrite** en `proxy.ts`, que ya existe
  para reescribir `{slug}.storelite.app` → `app/[slug]`. Solo habría que
  ampliarlo para que `mitienda.com` también resuelva al slug correcto.
- **Vercel soporta custom domains por proyecto**: el dominio del seller se
  registra como custom domain del único proyecto de Store Lite y apunta a la
  app. Vercel emite HTTPS/SSL automáticamente.

**El costo no es hosting; es operación a escala.**

---

## Qué sí es complejo/caro (el costo real)

| Área                         | Detalle                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Verificación del dominio** | El seller debe probar que `mitienda.com` es suyo (registro DNS TXT/CNAME). Requiere wizard + instrucciones + soporte.   |
| **HTTPS/SSL automático**     | Vercel lo emite solo, pero hay rate limits al agregar muchos dominios.                                                  |
| **Soporte al cliente**       | Los sellers rompen su DNS, se les vence el registro, preguntan por qué no carga. Es el mayor costo oculto.              |
| **Costo monetario**          | **El dominio lo paga el seller** (≈ US$10–15/año, no es gasto de la plataforma). Tu costo es 100% operativo/desarrollo. |

---

## Propuesta de modelo de precios (decidido 2026-08-31)

| Plan                       | Higiene técnica SEO  | SEO avanzado (SERP preview, override) | Dominio                              |
| -------------------------- | -------------------- | ------------------------------------- | ------------------------------------ |
| **Básico (free)**          | ✅ Gratis para todos | ❌                                    | Subdominio `slug.storelite.app`      |
| **Emprendedor (S/59)**     | ✅                   | ✅                                    | Subdominio                           |
| **Business Pro (S/99)**    | ✅                   | ✅                                    | Subdominio                           |
| **Enterprise Pro (S/149)** | ✅                   | ✅                                    | **`mitienda.com` (futuro / add-on)** |

- **Higiene técnica SEO** (canonical, sitemap, JSON-LD, OG image): gratis para
  todos, es piso de calidad. No se cobra ni se gatea.
- **SEO avanzado** (SERP preview, "SEO avanzado" plegado, override manual del
  seller, sugerencias IA): **solo plan pago** (Emprendedor+). Requiere flag
  nuevo `seoAdvancedEnabled` en `PLAN_ENTITLEMENTS`.
- **Dominio propio** (`mitienda.com`, paga el seller): feature del plan más
  alto (o add-on). El gancho para que el seller «pase en serio» al tier caro.

El dominio propio como **feature del plan más alto** (o como add-on aparte).
Es el gancho para que el seller «pase en serio» y pague el tier caro.

---

## Dependencias / bloqueantes para implementarlo

1. **Mapa de dominio → slug**: dónde guardamos `mitienda.com → business_slug`
   (nueva tabla o columna en `businesses`).
2. **`proxy.ts`**: ampliar la detección de tenant para que un hostname custom
   (no solo `*.storelite.app`) resuelva al slug.
3. **Verificación de propiedad**: endpoint + acción que valide el DNS del
   seller antes de activar el dominio.
4. **Canonical/URL dinámica**: `getCanonicalBusinessUrl()` ya centraliza la
   construcción de URL; habría que hacerla aware del dominio custom.
5. **Costos de soporte**: estimar horas de soporte antes de lanzar.

---

## Próximo paso sugerido

Cuando se decida avanzar, crear un cambio SDD (`/sdd-new custom-domains`) y
hacer una prueba de concepto primero con **1 dominio real** antes de abrir la
feature a todos.
