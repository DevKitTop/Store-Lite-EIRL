# Tasks: Refactor schema.ts into Domain-Specific Files

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2,688 (additions + deletions) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

> **Note**: Raw diff is large (~2,688 lines) because 13 files are created/modified, but this is a **pure mechanical refactor** — zero behavioral changes, zero new logic. Every file is extracted verbatim with import adjustments only. Splitting into chained PRs would increase review burden (re-review identical code across slices) without benefit.

### Suggested Work Units

| Unit | Goal | PR |
|------|------|----|
| 1 | Move code into domain files + barrel + re-export | Single PR |

---

## Phase 1: Foundation — Directory + Bottom Layer

- [x] **1.1** Create `src/core/database/schema/` directory, then create `enums.ts` — extract all 14 `pgEnum` definitions (themeMode, contrastLevel, mediaType, paymentStatus, paymentMethod, subscriptionPlan, subscriptionStatus, shippingType, planPaymentStatus, notificationType, notificationCategory, orderStatus, importJobStatus, importRowStatus)
- [x] **1.2** Create `profiles.ts` — extract `profiles` table with its column definitions, indexes, and co-located type exports (`Profile`, `NewProfile`)

## Phase 2: Core Domain Files (Follows Dependency DAG)

- [x] **2.1** Create `businesses.ts` — extract 9 tables with indexes and types: `businesses`, `businessSlugAliases`, `formMessages`, `businessSubscriptions`, `businessSettings`, `businessInvitations`, `businessTeamMembers`, `businessTeamRoles`, `saasIssuerConfig`. Import from `./enums` and `./profiles` as needed.
- [x] **2.2** Create `products.ts` — extract `productCategories`, `products`, `productMedia`, `productLikes` with indexes and types. Import from `./enums` and `./businesses`.
- [x] **2.3** Create `notifications.ts` — extract `notifications` table with indexes and types. Import from `./enums` and `./businesses`.
- [x] **2.4** Create `verification.ts` — extract `verificationOtps` table with indexes and types. No cross-file imports needed (no FK refs to other user tables).
- [x] **2.5** Create `orders.ts` — extract `payments`, `orderEvents`, `sellerPayoutAccounts`, `planPayments`, `paymentOrders`, `paymentIdempotencyKeys` with indexes and types. Import from `./enums`, `./profiles`, `./businesses`, `./products`.
- [x] **2.6** Create `chat.ts` — extract `chatSessions`, `messages` with indexes and types. Import from `./enums`, `./businesses`, `./orders` (FK: chatSessions → payments).
- [x] **2.7** Create `imports.ts` — extract `importJobs`, `importRows` with indexes, enums, and types. Import from `./enums`, `./businesses`, `./products` (FK: importRows → products).

## Phase 3: Integration — Relations + Types + Barrel

- [x] **3.1** Create `relations.ts` — extract all 18 `relations()` definitions. Import from ALL domain files (enums, profiles, businesses, products, orders, chat, notifications, imports, verification).
- [x] **3.2** Create `types.ts` — extract enum value types (`OrderStatus`, `SubscriptionPlan`, `SubscriptionStatus`, `NotificationType`, `NotificationCategory`) and `formatTicketNumber` function. Import from `./enums`.
- [x] **3.3** Create `index.ts` — barrel file re-exporting all exports from all 11 sibling files (`export * from './...'`).

## Phase 4: Cutover — Modify schema.ts

- [x] **4.1** Replace `src/core/database/schema.ts` content with: `export * from './schema/index'` (keep existing imports from drizzle-orm/drizzle-orm/pg-core — they are needed for dependency resolution, or remove if barrel covers them; verify first with `tsc --noEmit`).

## Phase 5: Verification

- [x] **5.1** Run `pnpm type-check` (tsc --noEmit) — zero errors required
- [x] **5.2** Run `pnpm test:unit` — all existing tests pass
- [x] **5.3** Import audit: verify all 24 import sites resolve (23 `from '@/core/database/schema'` + 1 `import * as schema from './schema'` in client.ts)
- [x] **5.4** Verify `git diff --stat` shows deletions ≈ additions (no net new code)
- [x] **5.5** Drizzle relation resolution: import `relations.ts` standalone or via `index.ts` and verify no `ReferenceError` on lazy FK callbacks
