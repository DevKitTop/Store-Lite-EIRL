import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businessTeamMembers } from '@/core/database/schema';
import { isBusinessOwner } from '@/lib/permissions/checkPermission';
import { createServerClient } from '@supabase/ssr';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

export interface InvitationInfo {
  code: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: Date | null;
}

// =====================================================
// HELPERS
// =====================================================

/**
 * Creates a Supabase client bound to the current user's session
 */
export async function createUserAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });
}

/**
 * Generate a random invitation code (XXXX-XXXX format).
 *
 * The code is a capability: whoever holds it can join the team. That is why the
 * randomness comes from `crypto`, not `Math.random`, which is predictable by
 * design and unfit for anything an attacker must not guess.
 *
 * The alphabet has exactly 32 characters, so `byte % 32` is uniform over a byte
 * and needs no rejection sampling.
 */
export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O, 0, 1, I to avoid confusion
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars8 = Array.from(bytes, (byte) => chars.charAt(byte % chars.length));
  return `${chars8.slice(0, 4).join('')}-${chars8.slice(4).join('')}`;
}

/**
 * Hash the code for storage using Web Crypto API
 */
export async function hashCode(code: string): Promise<string> {
  // Use Web Crypto API for server-side hashing
  const encoder = new TextEncoder();
  const data = encoder.encode(`store-lite-team-2026:${code}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Check if user is the owner of a business
 */
export async function assertOwnership(
  businessId: string,
): Promise<{ userId: string | null; error: string | null }> {
  const supabase = await createUserAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { userId: null, error: 'No autenticado.' };
  }

  // Ownership comes from the definer function: the business row is not readable
  // through a helper any more, and this check must not be the exception.
  if (!(await isBusinessOwner(businessId, user.id))) {
    return { userId: user.id, error: 'No tienes permiso para realizar esta acción.' };
  }

  return { userId: user.id, error: null };
}

/**
 * Get current team member count (owner + members)
 */
export async function getTeamMemberCount(businessId: string): Promise<number> {
  const members = await db.query.businessTeamMembers.findMany({
    where: eq(businessTeamMembers.businessId, businessId),
    columns: { id: true },
  });
  return members.length + 1; // +1 for owner
}
