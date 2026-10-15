# Seller Order Authorization Specification

> **Archived state — 2026-09-28.** Promoted from
> `openspec/changes/access-hardening-batch2/` at SDD archive. This file describes what actually
> SHIPPED (tracker `feat/access-hardening-batch2` @ `9559f3a`, 3 commits, PRs #197 + the
> slice-1 test commit). Two reconciliations were applied during the archive pass and are marked
> inline: the gate-helper contract in R4, and the per-file duplication note under R2. Read the
> archived `spec.md` for the full delta provenance.

## Purpose

Six seller order server actions validate only that the client-supplied `businessId` matches the payment row. Any caller who knows a `paymentId` + `businessId` can drive another tenant's order state machine. This spec gates all six on a new `orders.manage` permission via the existing `checkPermission` primitive. Owner passes implicitly; no migrations, no new env vars, no new roles.

| Action                         | File                     | Denial message on gate failure             |
| ------------------------------ | ------------------------ | ------------------------------------------ |
| `uploadTicketAndUpdatePayment` | `ticketActions.ts`       | `No tienes permisos para este pedido`      |
| `notifyDelivery`               | `ticketActions.ts`       | `No tienes permisos para este pedido`      |
| `prepareOrder`                 | `ticketActions.ts`       | `No tienes permisos para este pedido`      |
| `markReadyForPickup`           | `ticketActions.ts`       | `No tienes permisos para este pedido`      |
| `confirmPickedUp`              | `ticketActions.ts`       | `No tienes permisos para este pedido`      |
| `requestFinalization`          | `finalizationActions.ts` | `Pago no encontrado o no tienes permisos.` |

## Requirements

### Requirement: R1 — `orders.manage` permission definition

`orders.manage` MUST be added to the `Permission` union, to the `owner`, `admin` AND `member` default arrays, to `PERMISSION_LABELS`, and to a new `orders` group in `PERMISSION_GROUPS`. `PERMISSION_LABELS` is an exhaustive `Record`, so a missing entry MUST fail compilation. A permission with no group entry MUST NOT ship — `PermissionsMatrix` renders only groups, so it would be unassignable.

#### Scenario: Owner is granted the permission implicitly

- GIVEN business B owned by user U
- WHEN `checkPermission(B, U, 'orders.manage')` resolves
- THEN true, via the owner short-circuit, without consulting any membership row

#### Scenario: Permission is assignable in the UI

- GIVEN a business owner opening the team permissions matrix
- WHEN the `orders` group renders
- THEN `orders.manage` is listed and toggleable; submitted values pass `app/actions/team/roles.ts` validation

### Requirement: R2 — Gate placement precedes every DB read and both flow paths

The gate MUST run at the top of each action, BEFORE the payment lookup, and OUTSIDE the `if (env.orderFlowV2)` block. Five of the six actions retain a legacy inline-mutation path when `orderFlowV2` is false; a gate inside the block would leave those paths unguarded.

Archived-state note (reconciled at archive, 2026-09-28): the gate shipped as a private
`requireOrderManager(businessId): Promise<{ ok: true; actorId: string } | { ok: false }>` helper,
duplicated **byte-identically** in `src/features/dashboard/actions/ticketActions.ts:68-76` and
`src/features/dashboard/actions/finalizationActions.ts:67-75` — two module-private copies, not one
shared primitive. Call sites use `const gate = await requireOrderManager(businessId); if (!gate.ok)
return { success: false, error: NO_PERMISSION_ERROR };` as the first statement inside `try {`
(`ticketActions.ts:98, 228, 308, 356, 408`; `finalizationActions.ts:112`). Behaviour matches this
requirement exactly; the duplication is recorded as a follow-up (hoist to
`src/lib/permissions/`), not a defect. The design did not plan the helper — it was extracted
during apply as a REFACTOR.

#### Scenario: Legacy path is guarded

- GIVEN `env.orderFlowV2` is false and a caller without `orders.manage` on B
- WHEN `uploadTicketAndUpdatePayment`, `notifyDelivery` or `requestFinalization` is invoked
- THEN the action returns the denial and performs no payment write

#### Scenario: Unauthorized caller never reaches the row

- GIVEN a caller lacking `orders.manage` and a `paymentId` that does not exist
- WHEN any of the six actions is invoked
- THEN the denial message is returned, not `Pedido no encontrado` — the gate outranks the not-found branch

### Requirement: R3 — Authorization outcome uses the existing result contract

A failed gate MUST return the action's existing result shape — `{ success: false, error: string }` — and MUST NOT throw. No `errorCode` field exists on any of the six result interfaces, and every action body is already wrapped in a `try/catch` that would collapse a throw into a generic message. `OrderModal.tsx:181,197,213,229,255` reads `result.error` into `alert()` / `setCodeError()`, so the gate MUST reuse the string each action already used for its own authorization failure (table above) and MUST NOT introduce a new user-facing string. The same string MUST be used for the unresolved-actor and the permission-denied branches, so an anonymous caller learns nothing about session state.

#### Scenario: Permission denied returns a displayable error

- GIVEN a member of B without `orders.manage`
- WHEN `prepareOrder` is invoked from `OrderModal`
- THEN `{ success: false, error: 'No tienes permisos para este pedido' }`, surfaced by the existing alert path

#### Scenario: Unauthenticated caller is denied identically

- GIVEN no resolvable session actor
- WHEN any of the six actions is invoked
- THEN the same denial shape and string as the permission-denied branch; no DB query, no write

#### Scenario: Gate error outranks the flow-flag error

- GIVEN an unauthorized caller and `env.orderFlowV2` false
- WHEN `markReadyForPickup` is invoked
- THEN the authorization error is returned, not `El flujo de recojo requiere orderFlowV2`

### Requirement: R4 — Resolved actor drives attribution

Each action MUST resolve the actor exactly once and MUST reuse that value as the transition actor `{ type: 'seller', id: actorId }`. The `?? undefined` fallback MUST be removed, and the action MUST abort rather than proceed with an unresolved actor. The audit trail MUST therefore always carry a real seller id.

Archived-state note (reconciled at archive, 2026-09-28): this requirement originally read
"resolve the actor once, **before the gate**". The shipped code resolves the actor **inside** the
gate helper and returns it, so the action never holds a nullable id at all:

```ts
async function requireOrderManager(businessId: string) {
  const actorId = await getAuthenticatedUserId();
  if (!actorId) return { ok: false }; // hard abort, not a permissive default
  const canManage = await checkPermission(businessId, actorId, 'orders.manage');
  if (!canManage) return { ok: false };
  return { ok: true, actorId }; // narrowed to `string`
}
```

`const { actorId } = gate;` therefore yields a `string`, which is what makes the dropped
`?? undefined` a provable no-op rather than a silent hole (verified slice 1: dead-coding
`id: actorId ?? undefined` produced **0** test failures because the type already forbids it).
Resolution happens exactly once per action — the inner `const actorId = await
getAuthenticatedUserId()` that previously duplicated the Supabase + `profiles.findFirst` round
trips is gone.

#### Scenario: Timeline event records the real actor

- GIVEN an authorized caller U on business B
- WHEN `confirmPickedUp` succeeds
- THEN the timeline event actor is `{ type: 'seller', id: U }` with no undefined id

#### Scenario: Owner implicitly permitted

- GIVEN a caller who owns the payment's business
- WHEN any of the six actions is invoked
- THEN it proceeds without an `orders.manage` grant being persisted for that caller

### Requirement: R5 — Persisted permission sets shadow the new default

`getMemberPermissions` resolves owner → `membership.customPermissions` → `businessTeamRoles` → role defaults. Any business that has ever saved a custom permission set keeps its stored array and therefore does NOT gain `orders.manage`. This shadowing is ACCEPTED for this batch; the remedy is operational (the owner re-saves the permission set). No migration and no code fallback to `isTeamMember` is in scope.

#### Scenario: Member with a stale custom permission set is denied

- GIVEN member M of B with a persisted `customPermissions` array lacking `orders.manage`
- WHEN M invokes a gated action
- THEN denied with the R3 message; re-saving M's permissions restores access

## Out of Scope

- UI gating of the order buttons in `OrderModal` / `PhaseShippingSection` — a denied member sees enabled buttons that fail with the R3 message. Follow-up slice.
- `confirmFinalization` and `rejectFinalization` — already gated by the customer `trackingToken`.
- Any migration, backfill, or `isTeamMember` fallback to bypass `customPermissions` shadowing.
- WhatsApp chain (W-W2/W-W3), RLS work (C1/C2/C4), Culqi unification, and the duplicated `AUTH_ORIGIN` consts.
