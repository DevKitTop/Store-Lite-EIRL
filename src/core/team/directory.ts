import { db } from '@/core/database/client';
import { sql } from 'drizzle-orm';

/** The shape a roster row takes once it is safe to show. */
export interface TeamMember {
  id: string;
  userId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  role: string;
  joinedAt: Date;
}

/**
 * Raw shape returned by `public.business_team_directory`.
 *
 * The function returns zero rows unless the given user belongs to the business,
 * so "not a member" and "no such business" look the same from here — on
 * purpose. Ownership carries no join date, which is why `joined_at` is null for
 * the owner row: there is nothing truthful to put there.
 */
interface TeamDirectoryRow {
  kind: 'owner' | 'member';
  membership_id: string | null;
  user_id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string;
  joined_at: Date | null;
}

function toTeamMember(row: TeamDirectoryRow): TeamMember {
  return {
    id: row.kind === 'owner' ? 'owner' : (row.membership_id ?? row.user_id),
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    role: row.role,
    joinedAt: row.joined_at ?? new Date(),
  };
}

/**
 * Resolve the roster of a business for one of its members.
 *
 * The membership check lives in the database function, not in a comparison
 * here, so a caller that forgets a role check still gets no roster. `null`
 * means "this user cannot see this team", which covers both a business that
 * does not exist and one they do not belong to.
 */
export async function resolveTeamDirectory(
  businessId: string,
  userId: string,
): Promise<TeamMember[] | null> {
  const rows = (await db.execute(sql`
    select * from public.business_team_directory(${businessId}::uuid, ${userId}::uuid)
  `)) as unknown as TeamDirectoryRow[];

  if (rows.length === 0) {
    return null;
  }

  return rows.map(toTeamMember);
}
