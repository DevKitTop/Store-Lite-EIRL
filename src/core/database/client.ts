// =====================================================
// DRIZZLE DATABASE CLIENT
// =====================================================
// Description: Configured Drizzle client for database operations
// Usage: Import { db } from '@/database/client' in your app
// =====================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Connection pooling configuration for Supabase
// Uses transaction mode pooler for serverless compatibility
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL or POSTGRES_URL environment variable is not set. Please check your production configuration.',
  );
}
// ---------------------------------------------------------
// SINGLETON PATTERN (Prevention of connection exhaustion)
// ---------------------------------------------------------
// In development, hot reloads can create multiple connection pools.
// We store the client in the global scope to reuse it.
const globalForDb = globalThis as unknown as {
  client: postgres.Sql | undefined;
};

export const client =
  globalForDb.client ??
  postgres(connectionString, {
    max: 10, // Maximum connections in pool
    idle_timeout: 20, // Close idle connections after 20s
    connect_timeout: 20, // Connection timeout 20s
    onnotice: (notice) => {
      if (notice.severity === 'FATAL' || notice.severity === 'ERROR') {
        console.error('[DB NOTICE]:', notice.message);
      }
    },
  });

if (process.env.NODE_ENV !== 'production') globalForDb.client = client;

// Initialize Drizzle with schema
//
// ⚠️ This is the SYSTEM client: the connection role carries BYPASSRLS, so
// row-level security is never evaluated on these queries. It is the right
// client for work that legitimately spans tenants (webhooks, cron,
// reconciliation) and the wrong one for anything acting on behalf of a single
// business or customer. Tenant-scoped work goes through
// `withTenantContext` in `./tenant`, which sets the request claims inside a
// transaction so the policies apply once the connection is switched.
export const db = drizzle(client, { schema });

// Export schema for use in queries
export { schema };
