# Design: Refactor schema.ts into Domain-Specific Files

## Technical Approach

Split the 1,344-line `schema.ts` into 12 domain files under `schema/` with a barrel re-export chain. Zero behavioral changes. All 58 existing `@/core/database/schema` imports work unchanged.

## Architecture Decisions

### Decision: Domain File Boundaries

| Option | Tradeoff | Decision |
|--------|----------|----------|
| 1 file per table (26 files) | Too granular, 26 import lines per barrel | ❌ |
| 3-4 broad groups | Loses domain cohesion | ❌ |
| **12 files by business concept** | Matches existing `=====` section boundaries; manageable | ✅ |

### Decision: Circular Import Prevention

**Choice**: Relations in a separate leaf file (`relations.ts`) that imports all domain files. Domain files import only from lower layers. Drizzle's lazy `() => table` FK callback handles cross-file references.

**Rationale**: The dependency graph is a DAG — no genuine circular imports exist. The only cross-file FK (`chatSessions → payments`) is one-way (chat.ts imports orders.ts). Relations are the single merge point.

**Import layer cake** (each layer imports only from layers above):
```
enums.ts (no deps) → profiles.ts (enums) → businesses.ts (profiles)
→ products.ts, notifications.ts, verification.ts (businesses)
→ orders.ts (profiles, businesses, products)
→ chat.ts (businesses, orders), imports.ts (businesses, products)
→ relations.ts (ALL), types.ts (ALL)
```

### Decision: Co-located Type Exports

**Choice**: Each domain file exports `InferSelectModel`/`InferInsertModel` types alongside its table. `types.ts` holds only enum value types (`OrderStatus`, `SubscriptionPlan`, etc.) and `formatTicketNumber`.

**Rationale**: When a table column changes, the type updates in the same file. The barrel re-export ensures `@/core/database/schema` resolves all types regardless of origin.

### Decision: Non-Drizzle Database Types Unchanged

**Choice**: `database.types.ts` (Supabase-generated types with `Tables<>` helpers) is untouched. It's a completely separate concern.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/core/database/schema/enums.ts` | Create | All 12 `pgEnum` definitions |
| `src/core/database/schema/profiles.ts` | Create | `profiles` table + `Profile`, `NewProfile` types |
| `src/core/database/schema/businesses.ts` | Create | 9 tables (businesses, slugAliases, formMessages, subscriptions, settings, invitations, teamMembers, teamRoles, saasIssuerConfig) + types |
| `src/core/database/schema/products.ts` | Create | 4 tables (categories, products, media, likes) + types |
| `src/core/database/schema/chat.ts` | Create | `chatSessions`, `messages` + types |
| `src/core/database/schema/orders.ts` | Create | 6 tables (payments, orderEvents, payoutAccounts, planPayments, paymentOrders, idempotencyKeys) + types |
| `src/core/database/schema/notifications.ts` | Create | `notifications` + types |
| `src/core/database/schema/imports.ts` | Create | `importJobs`, `importRows` + types |
| `src/core/database/schema/verification.ts` | Create | `verificationOtps` + types |
| `src/core/database/schema/relations.ts` | Create | All 18 relation definitions (imports every domain file) |
| `src/core/database/schema/types.ts` | Create | Enum value types (`OrderStatus`, `SubscriptionPlan`, `NotificationType`, `NotificationCategory`) + `formatTicketNumber` |
| `src/core/database/schema/index.ts` | Create | Barrel: `export *` from all 11 sibling files |
| `src/core/database/schema.ts` | Modify | Replace 1,344 lines with `export * from './schema/index'` |

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Type-check | All imports resolve | `tsc --noEmit` — zero errors required |
| Import audit | All 58 consumer sites | Grep `from '@/core/database/schema'` → verify each export name is reachable |
| Runtime | Drizzle relations resolve | Import `relations.ts` in test, verify no `ReferenceError` |
| Line count | Refactor is move-only | `git diff --stat` — deletions ≈ additions (no net new code) |

## Migration / Rollout

Apply atomically in a single commit. Verify with `tsc --noEmit` before committing.

## Rollback Plan
```
git checkout src/core/database/schema.ts
Remove-Item -Recurse src/core/database/schema/
```
Every import returns to original state. No migration steps.

## Open Questions
- None — the refactor is mechanical. Every risk has a verified mitigation.
