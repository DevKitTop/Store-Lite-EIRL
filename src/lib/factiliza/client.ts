// =====================================================
// JSON.pe API CLIENT (Server-side only)
// =====================================================
// Description: HTTP client for JSON.pe API (RUC, DNI, representatives)
// Usage: Import { getRucInfo } from '@/lib/factiliza/client'
// Base URL configurable via env JSONPE_API_BASE_URL
// =====================================================

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import type {
  CacheEntry,
  JsonpeDniInfo,
  JsonpeRepresentative,
  JsonpeResponse,
  JsonpeRucInfo,
} from './types';

// Re-export types for consumers
export type { JsonpeDniInfo, JsonpeRepresentative, JsonpeRucInfo };

// Base URL from env — configurable without code changes
const API_BASE_URL = env.jsonpeApiBaseUrl;

// Cache instance
const apiCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cleanExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of apiCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      apiCache.delete(key);
    }
  }
}

async function cachedFetch<T>(key: string, fetchFn: () => Promise<T>): Promise<T> {
  cleanExpiredCache();
  const cached = apiCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as T;
  }

  const data = await fetchFn();
  apiCache.set(key, { data, timestamp: Date.now() });
  return data;
}

/**
 * Generic POST to JSON.pe API
 * All JSON.pe endpoints use POST with JSON body and Bearer token
 */
async function apiPost<T>(endpoint: string, body: Record<string, string>): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.jsonToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');

    // 404 = not found (valid response — RUC/DNI doesn't exist)
    if (response.status === 404) {
      return { success: false, message: 'Not found', data: null } as T;
    }

    // Generic error — NEVER expose provider name or internal details
    logger.error('factiliza: HTTP error', { status: response.status, body: errorBody });
    throw new Error('Error al consultar el documento. Intente nuevamente.');
  }

  const json: JsonpeResponse<T> = await response.json();

  if (!json.success) {
    logger.warn('factiliza: response error', { message: json.message });
    throw new Error(json.message || 'Error al consultar el documento.');
  }

  return json.data;
}

// =====================================================
// PUBLIC API METHODS
// =====================================================

/**
 * Obtiene información de un RUC
 * POST /api/ruc  { "ruc": "..." }
 */
export async function getRucInfo(ruc: string): Promise<JsonpeRucInfo> {
  return cachedFetch(`ruc:${ruc}`, () => apiPost<JsonpeRucInfo>('/ruc', { ruc }));
}

/**
 * Obtiene los representantes legales de un RUC
 * POST /api/ruc/representantes  { "ruc": "..." }
 */
export async function getRucRepresentatives(ruc: string): Promise<JsonpeRepresentative[]> {
  return cachedFetch(`representatives:${ruc}`, () =>
    apiPost<JsonpeRepresentative[]>('/ruc/representantes', { ruc }),
  );
}

/**
 * Obtiene información de un DNI
 * POST /api/dni  { "dni": "..." }
 */
export async function getDniInfo(dni: string): Promise<JsonpeDniInfo> {
  return cachedFetch(`dni:${dni}`, () => apiPost<JsonpeDniInfo>('/dni', { dni }));
}

/**
 * Genera un código OTP criptográfico de 6 dígitos
 */
export function generateOTP(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let otp = '';
  for (let i = 0; i < 6; i++) {
    otp += (bytes[i] % 10).toString();
  }
  return otp;
}
