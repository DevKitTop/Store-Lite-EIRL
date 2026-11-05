import { db } from '@/core/database/client';
import { sql } from 'drizzle-orm';

/**
 * What the database decides about a code. The names are the contract: the
 * action maps them to messages, and nothing here re-derives the answer.
 */
export type AcceptInvitationStatus =
  | 'joined'
  | 'invalid'
  | 'already_member'
  | 'owner'
  | 'unauthenticated';

export interface AcceptInvitationResult {
  status: AcceptInvitationStatus;
  invitationId: string | null;
}

interface AcceptInvitationRow {
  status: AcceptInvitationStatus;
  invitation_id: string | null;
}

/**
 * Redeem an invitation code for a user.
 *
 * The single-use rule lives inside the function, where the invitation row is
 * locked while the usage count is evaluated and the membership is written. A
 * caller cannot check it first and act later: between those two statements
 * another request can consume the same code.
 */
export async function acceptBusinessInvitation(
  businessId: string,
  code: string,
  userId: string,
): Promise<AcceptInvitationResult> {
  const rows = (await db.execute(sql`
    select status, invitation_id
    from public.accept_business_invitation(${businessId}::uuid, ${code}, ${userId}::uuid)
  `)) as unknown as AcceptInvitationRow[];

  const row = rows.at(0);

  if (!row) {
    return { status: 'invalid', invitationId: null };
  }

  return { status: row.status, invitationId: row.invitation_id };
}
