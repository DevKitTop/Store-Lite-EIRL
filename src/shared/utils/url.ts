// =====================================================
// URL HELPERS — Business URL construction
// =====================================================
// Description: Centralized URL building for business storefronts.
//   Phase 1: produces path-based URLs (store-lite.com/{slug}/...).
//   Future: can be switched to subdomain-based URLs ({slug}.store-lite.com/...)
//   without changing callers.
// =====================================================

import { env } from '@/config/env';

/**
 * Subdominios reservados que NO deben resolverse como negocios.
 */
export const RESERVED_SUBDOMAINS = [
  'www',
  'app',
  'api',
  'admin',
  'auth',
  'dashboard',
  'mail',
  'support',
  'static',
  'assets',
  'cdn',
  'docs',
  'blog',
  'status',
] as const;

export type ReservedSubdomain = (typeof RESERVED_SUBDOMAINS)[number];

/**
 * Construye un path relativo para un negocio.
 *
 * Cuando NO estamos en modo subdominio (path-based):
 *   getBusinessPath('mi-tienda', '/dashboard')  →  '/mi-tienda/dashboard'
 *   getBusinessPath('mi-tienda')                 →  '/mi-tienda'
 *
 * Cuando SÍ estamos en modo subdominio:
 *   getBusinessPath('mi-tienda', '/dashboard')  →  '/dashboard'
 *   getBusinessPath('mi-tienda')                 →  ''
 *   (el slug ya está en el hostname, no se duplica en el path)
 *
 * La detección del modo es automática:
 *   - Server-side: usa la feature flag FEATURE_SUBDOMAIN_REWRITE
 *   - Client-side: detecta el subdominio desde window.location.hostname
 */
export function getBusinessPath(slug: string, path = ''): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const cleanPath = normalizedPath === '/' ? '' : normalizedPath;

  // Fase 5: en modo subdominio el slug ya está en el hostname,
  // devolvemos solo el path para evitar URLs duplicadas como:
  //   tienda-1.store-lite.com/tienda-1/dashboard  (MAL)
  //   tienda-1.store-lite.com/dashboard           (BIEN)
  if (isSubdomainModeForSlug(slug)) {
    return cleanPath;
  }

  // Modo path-based: /{slug}/{path}
  return `/${slug}${cleanPath}`;
}

/**
 * Determina si la navegación actual está en modo subdominio para un slug dado.
 *
 * Server-side: evalúa la feature flag FEATURE_SUBDOMAIN_REWRITE.
 * Client-side: detecta dinámicamente si el hostname actual corresponde al slug
 * (ej: en mi-tienda.localhost:3000, el hostname contiene 'mi-tienda' como subdominio).
 */
function isSubdomainModeForSlug(slug: string): boolean {
  // ⚠️ Solo activar modo subdominio si FEATURE_SUBDOMAIN_REWRITE está habilitado.
  // Sin un proxy/rewrite que agregue el slug al path, las URLs sin slug
  // (ej: /order/{token}) no matchean ninguna ruta de Next.js.
  // Ver: https://nextjs.org/docs/app/api-reference/next-config-js/rewrites
  if (!env.featureSubdomainRewrite) return false;

  // Client-side: el hostname revela si ya estamos en un subdominio que coincide
  if (typeof window !== 'undefined') {
    const hostSlug = extractTenantSlugFromHost(window.location.hostname);
    return hostSlug === slug;
  }

  // Server-side: NO asumir subdominio solo por feature flag.
  //
  // El bug:
  //   /list-business -> redirect(getBusinessPath(selectedSlug))
  // con FEATURE_SUBDOMAIN_REWRITE=true devolvía "" en server,
  // generando redirects vacíos y loops/loading en localhost:3000.
  //
  // La feature flag indica que existe soporte de subdominio, no que todos
  // los redirects server-side deban ser relativos al host tenant.
  return false;
}

/**
 * Construye una URL canónica completa para un negocio.
 * Usada para SEO: JSON-LD, Open Graph, canonical link.
 *
 * Cuando FEATURE_SUBDOMAIN_REWRITE está activo, genera URLs con subdominio:
 *   getCanonicalBusinessUrl('mi-tienda', '/producto/123')
 *   → 'http://mi-tienda.localhost:3000/producto/123'  (dev)
 *   → 'https://mi-tienda.store-lite.com/producto/123'  (prod)
 *
 * Cuando está inactivo, genera URLs por path:
 *   getCanonicalBusinessUrl('mi-tienda', '/producto/123')
 *   → 'http://localhost:3000/mi-tienda/producto/123'
 */
export function getCanonicalBusinessUrl(slug: string, path = ''): string {
  const base = getBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (env.featureSubdomainRewrite) {
    const url = new URL(base);
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${slug}.${url.hostname}${port}${normalizedPath === '/' ? '' : normalizedPath}`;
  }

  return `${base}${getBusinessPath(slug, path)}`;
}

/**
 * Retorna la URL base de la aplicación.
 * En Fase 3 se puede reemplazar con detección dinámica de hostname.
 */
function getBaseUrl(): string {
  // Usamos la variable de entorno si está disponible
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  // Fallback para entorno de desarrollo
  return 'http://localhost:3000';
}

/**
 * Determina si un hostname corresponde a un subdominio de negocio.
 * Útil para el proxy rewrite (Fase 2).
 */
export function isTenantHost(hostname: string): boolean {
  const slug = extractTenantSlugFromHost(hostname);
  return slug !== null && !isReservedSubdomain(slug);
}

/**
 * Extrae el slug del negocio desde un hostname con subdominio.
 *
 * Ejemplo (producción):
 *   extractTenantSlugFromHost('mi-tienda.store-lite.com')  →  'mi-tienda'
 *   extractTenantSlugFromHost('store-lite.com')             →  null
 *   extractTenantSlugFromHost('admin.store-lite.com')       →  'admin' (pero es reservado)
 *
 * Ejemplo (local — .localhost):
 *   extractTenantSlugFromHost('mitienda.localhost')         →  'mitienda'
 *   extractTenantSlugFromHost('localhost')                  →  null
 */
export function extractTenantSlugFromHost(hostname: string): string | null {
  // Remover puerto si existe
  const host = hostname.split(':')[0];

  // Extraer subdominios del hostname
  // Para store-lite.com → parts = ['store-lite', 'com'] → sin subdominio
  // Para mi-tienda.store-lite.com → parts = ['mi-tienda', 'store-lite', 'com'] → subdominio = 'mi-tienda'
  const parts = host.split('.');

  // El TLD .localhost es especial para desarrollo local.
  //   mitienda.localhost → ['mitienda', 'localhost'] → 2 partes, slug = 'mitienda'
  //   localhost          → ['localhost']             → 1 parte,  sin subdominio
  // Para TLDs normales se requieren ≥3 partes (slug.domain.tld).
  const isLocalhostTld = parts.length > 0 && parts[parts.length - 1] === 'localhost';
  const minParts = isLocalhostTld ? 2 : 3;

  if (parts.length < minParts) {
    return null;
  }

  // El primer segmento es el potencial slug de negocio
  const potentialSlug = parts[0];

  // Validar que sea un slug válido (solo minúsculas, números, guiones)
  // Dos regex separados para evitar ReDoS: primero formato general, después borde con guion
  if (!/^[a-z0-9][a-z0-9-]{0,61}$/.test(potentialSlug)) {
    return null;
  }
  // No puede empezar ni terminar con guion
  if (potentialSlug.startsWith('-') || potentialSlug.endsWith('-')) {
    return null;
  }

  return potentialSlug;
}

/**
 * Verifica si un string es un subdominio reservado.
 */
export function isReservedSubdomain(slug: string): boolean {
  return (RESERVED_SUBDOMAINS as readonly string[]).includes(slug.toLowerCase());
}

/**
 * Normaliza un valor de origin a su forma canónica (`new URL(v).origin`).
 *
 * Se aplica a `NEXT_PUBLIC_AUTH_ORIGIN` para que la comparación de origins no
 * dependa de cómo está escrito el valor configurado: una barra final, un path,
 * el case del host o el puerto default explícito (`https://storelite.app:443`)
 * resuelven al mismo origin. Es idempotente: normalizar un origin ya canónico
 * devuelve el mismo string, así que no se revoca ninguna Origins permitidas hoy.
 *
 * Devuelve `null` (fail-closed) cuando el valor no sirve como origin:
 *   - vacío o no parseable (`'not a url'`, rutas relativas) → `new URL` lanza
 *   - origen opaco: `new URL('javascript:alert(1)').origin` es el string
 *     `'null'` (y `data:` igual). Sin esta guarda, un valor hostil en el env
 *     normalizaría a `'null'` y coincidiría con un origin de request hostil.
 */
function normalizeOrigin(value: string): string | null {
  if (!value) return null;
  try {
    const parsedValue = new URL(value);
    if (parsedValue.origin === 'null') return null;
    return parsedValue.origin;
  } catch {
    return null;
  }
}

/**
 * Valida un origin como destino de `postMessage` desde el popup de auth.
 *
 * `postMessage` acepta cualquier string como targetOrigin, así que un opener
 * hostil puede apuntar el popup a sí mismo y recibir los tokens. Por eso el
 * param `origin` de la URL se usa SOLO como input de esta allowlist:
 *   - mismo origen que la página (en prod el storefront y el popup comparten
 *     dominio, así que esta cláusula es la que sostiene el flujo real)
 *   - env.authOrigin (NEXT_PUBLIC_AUTH_ORIGIN) — superconjunto del anterior
 *   - host tenant, únicamente si FEATURE_SUBDOMAIN_REWRITE está activo
 *     (la rama queda preparada; hoy el flag es false)
 * Cualquier otro caso se deniega (fail-closed), incluidos `javascript:`,
 * `data:`, rutas relativas y strings vacíos.
 *
 * Solo se invoca desde el popup (componente cliente), donde `window` existe.
 */
export function isAllowedAuthReturnOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // Sin URL absoluta (relativo o vacío) → denegar. Los esquemas hostiles
    // (`javascript:`, `data:`) SÍ parsean y los deniega el fallthrough final.
    return false;
  }

  if (parsed.origin === window.location.origin) return true;
  const configuredOrigin = normalizeOrigin(env.authOrigin);
  if (configuredOrigin !== null && parsed.origin === configuredOrigin) return true;
  if (env.featureSubdomainRewrite && isTenantHost(parsed.hostname)) return true;

  return false;
}
