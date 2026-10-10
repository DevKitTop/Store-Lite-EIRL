# 🛒 Store Lite

<!-- Logo Oficial -->
<p align="center">
  <img src="https://raw.githubusercontent.com/devkittpo/store-lite/main/docs/assets/logo-store-lite.svg" alt="Store Lite Logo" width="120" />
</p>

Store Lite es una solución de comercio electrónico ligera y escalable construida con **Next.js 16 (App Router)** y **React 19**. Implementa el sistema de diseño **Material Design 3** mediante Web Components nativos para una experiencia de usuario fluida y de alto rendimiento.

## 🚀 Tecnologías Core (Stack Técnico)

- **Frontend Framework:** [Next.js 16.1+](https://nextjs.org/) (App Router, Server Components).
- **Runtime UI:** [React 19](https://react.dev/) (Hooks avanzados, Server Actions).
- **Design System:** [Material Web Components (@material/web)](https://github.com/material-components/material-web) + Material Design 3 tokens.
- **Base de Datos & ORM:** [Drizzle ORM](https://orm.drizzle.team/) + [PostgreSQL](https://www.postgresql.org/).
- **Infraestructura (BaaS):** [Supabase](https://supabase.com/) (Autenticación, Almacenamiento de archivos, Realtime).
- **Gestión de Estados:** Server-side state con Next.js Cache y Client-side global con React Context.
- **Tipado:** [TypeScript 5+](https://www.typescriptlang.org/).

## 📂 Arquitectura del Proyecto

El proyecto sigue una arquitectura **basada en características (Feature-driven)** dentro de un directorio `src`, facilitando el mantenimiento y la escalabilidad horizontal.

```text
├── app/                  # Rutas (App Router), Server Actions y Composición
│   ├── (main)/           # Layouts y vistas protegidas
│   ├── actions/          # Lógica de mutación de datos (Server Actions)
│   ├── api/              # Endpoints API (Node.js/Edge Runtime)
│   └── auth/             # Flujos de autenticación e inicio de sesión
├── src/
│   ├── features/         # Módulos de dominio encapsulados (Products, Cart, Auth)
│   ├── core/             # Proveedores globales, esquemas de DB y configuración base
│   ├── lib/              # Adaptadores e inicialización de SDKs (Supabase, MD3)
│   ├── shared/           # UI Kit atómico, hooks transversales y utilidades
│   ├── styles/           # Design Tokens, temas Dark/Light y utilidades CSS
│   └── types/            # Definiciones globales de TypeScript
├── database/             # Modelado de datos y scripts Drizzle
└── migrations/           # Control de versiones del esquema de base de datos
```

## 🧠 Lógica de Operación y Patrones

### 1. Estrategia de Renderizado

Se priorizan los **React Server Components (RSC)** para la recuperación inicial de datos (Data Fetching), reduciendo el bundle de JavaScript en el cliente y optimizando el Core Web Vitals (LCP, CLS).

### 2. Flujo de Datos

- **Lectura:** Acceso directo a la base de datos mediante Drizzle dentro de Server Components para latencia mínima.
- **Escritura:** Mutaciones mediante **Server Actions**, asegurando validación en el servidor y revalidación de caché instantánea con `revalidatePath`.

### 3. Sistema de Diseño (Material 3)

Utiliza **Material Web (@material/web)**, lo que permite componentes con fidelidad visual de Google sin las dependencias pesadas de librerías tipo CSS-in-JS. El tema es dinámico y soporta esquemas de color avanzados (Dark, Light, High Contrast).

### 4. Seguridad y Autenticación

Protección de rutas mediante **Supabase Middleware** en el Edge, permitiendo verificaciones de sesión antes de que el servidor Next.js procese la petición.

## 📢 Notificaciones Broadcast (SASS → Sellers)

Hay **3 formas** de crear notificaciones para los sellers desde el panel SASS:

### 1. CLI script (`scripts/notify.mjs`)

```bash
node scripts/notify.mjs "Título" "Mensaje" [flags]

# Ejemplo
node scripts/notify.mjs "Novedad" "Plan Pro 50% OFF" --target all --category plan
```

Flags disponibles:

- `--target all` — todos los sellers (default)
- `--target id1,id2,id3` — business IDs específicos
- `--category sistema` — categoría visual (default: sistema)
- `--type system` — tipo interno (default: system)

Requiere `SASS_API_KEY` en el entorno.

### 2. curl / HTTP directo

```bash
curl -X POST http://localhost:3000/api/sass/notifications/broadcast \
  -H "Content-Type: application/json" \
  -H "x-sass-key: $SASS_API_KEY" \
  -d '{
    "title": "Novedad",
    "message": "Plan Pro 50% OFF",
    "category": "plan",
    "type": "system",
    "target": "all"
  }'
```

El endpoint acepta `target: "all"` o `target: ["id1", "id2"]`.

### 3. CRON automático (`GET /api/cron/check-plans`)

Ejecutado por **Vercel Cron** diariamente a las 8:00 AM. Revisa los planes próximos a vencer y envía notificaciones automáticas:

- **D-7**: "Tu plan {nombre} vence en 7 días"
- **D-3**: "Tu plan {nombre} vence en 3 días — renovalo para no perder funciones"
- **D-1**: "Tu plan {nombre} vence mañana"
- **Expirado**: "Tu plan {nombre} ha expirado — tus funciones están limitadas"

Incluye deduplicación: no envía la misma notificación dos veces en el mismo día.

### Variables de entorno

| Variable                     | Descripción                                                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `SASS_API_KEY`               | Clave para autenticar broadcasts contra el endpoint                                                                              |
| `CRON_SECRET`                | Clave para autenticar requests de Vercel Cron                                                                                    |
| `PLATFORM_ADMIN_IDS`         | IDs de usuario de Supabase (separados por coma) autorizados en endpoints de operador. Si queda vacío, nadie está autorizado      |
| `ORDER_ACCESS_COOKIE_SECRET` | Secreto HMAC de la cookie firmada `order_access_{token}` que habilita el acceso completo a la página de seguimiento de una orden |

> `ORDER_ACCESS_COOKIE_SECRET` es **obligatoria** en cada entorno desplegado y
> **no tiene fallback**: si queda vacía, la verificación falla siempre y la página
> de seguimiento sirve únicamente la proyección pública — sin email, DNI, teléfono
> ni dirección del comprador. Eso es intencionado (fail-closed): un fallback
> conocido haría que un despliegue sin secreto _autorizara_ el acceso completo.
> Mantenela **estable entre despliegues**: rotarla invalida las cookies vivas y
> cada comprador pierde sus secciones PII hasta que se vuelva a verificar. Generala
> con `openssl rand -base64 32`.

> `GET /api/billing/sunat-report` es cross-tenant y requiere **o bien** un usuario
> listado en `PLATFORM_ADMIN_IDS` **o bien** el header `x-sass-key` con el valor de
> `SASS_API_KEY`. Configuralo **antes** de desplegar el cambio: si queda vacío, el
> operador recibe 401.

## 🛠️ Configuración de Desarrollo

```bash
# Instalación de dependencias
pnpm install

# Iniciar servidor de desarrollo
pnpm dev

# Generar migraciones de base de datos
pnpm drizzle-kit generate
```

## 🔐 Usuario de Validación Culqi (Email + Contraseña)

Para la revisión de llaves live de Culqi se usa una cuenta de validación que
inicia sesión con email y contraseña en `/auth`. La cuenta se provisiona con un
script idempotente (crea el usuario si no existe, o actualiza sus credenciales si
ya existe):

```bash
# Vía variables de entorno
CULQI_TEST_EMAIL=usuario@ejemplo.com CULQI_TEST_PASSWORD='...' pnpm culqi:create-test-user

# O vía CLI (los argumentos tienen prioridad sobre el entorno)
pnpm culqi:create-test-user --email=usuario@ejemplo.com --password='...'
```

> ⚠️ Las credenciales NUNCA se escriben en el repositorio: solo se pasan por
> variables de entorno o argumentos de CLI, nunca se commitean.

### 🏪 Tienda demo con `--with-store`

Para que el revisor de Culqi entre y tenga un storefront funcional al instante
(sin fricción de onboarding), el script puede además provisionar una tienda
demo completa con el flag `--with-store`:

```bash
pnpm culqi:create-test-user --email=usuario@ejemplo.com --password='...' --with-store
```

Esto crea (o actualiza, en re-ejecución — el script es idempotente):

- **Negocio**: `Tienda Demo Culqi` con slug único (`tienda-demo-culqi-store-*`),
  activo, con datos de contacto de Perú.
- **Ajustes de tienda**: theme y layout por defecto del storefront.
- **Suscripción**: plan `basico` con estado `active` (si el revisor ya
  upgradeara el plan, no se toca).
- **Producto demo**: `Curso Demo de Tienda Online` (S/ 49.90), disponible, con
  stock, listo para probar el checkout.

Los datos demo (nombres, slug, precio) son fixtures de prueba y viven como
constantes en el script; no son secretos. Al finalizar imprime la URL de la
tienda (`NEXT_PUBLIC_APP_URL` o `http://localhost:3000`).

Checklist operativa antes de la revisión de Culqi:

- [ ] `CULQI_ENFORCE_LIVE_KEYS=true` en producción
- [ ] Llaves live (`pk_live_*` / `sk_live_*`) configuradas en el negocio de prueba
      (el revisor las pega en Ajustes → Pagos; el script no las setea a propósito)
- [ ] Tienda demo provisionada con `--with-store` (negocio + producto demo)

---

_Store Lite v1.0 - Enfocado en robustez técnica y agilidad._
