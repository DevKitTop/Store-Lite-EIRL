# Proposal: Refactor schema.ts into Domain-Specific Files

## Intent

`src/core/database/schema.ts` has grown to ~1,344 lines mixing enums, tables, relations, and types in one file. This hurts navigation, review, and merge conflict resolution. Split into domain files with a barrel re-export so all imports keep working.

## Scope

### In Scope
- Move all `pgEnum` definitions → `schema/enums.ts`
- Split table definitions by domain (profiles, businesses, products, chat, orders, notifications, imports, verification)
- Extract relations → `schema/relations.ts`
- Extract type exports + helpers → `schema/types.ts`
- `schema/index.ts` barrel + `schema.ts` re-exports from it (zero import changes)

### Out of Scope
- No schema column/table changes
- No migration generation or running
- No changes to dependent files

## Capabilities

**New**: None. **Modified**: None. Pure refactor.

## Approach

1. Create `src/core/database/schema/` with domain files
2. Each file exports its tables and types: `profiles.ts`, `businesses.ts`, `products.ts`, `chat.ts`, `orders.ts`, `notifications.ts`, `imports.ts`, `verification.ts`
3. `relations.ts` imports all tables (avoids circular deps)
4. `types.ts` exports all infer types + `formatTicketNumber`
5. `index.ts` barrel re-exports everything; `schema.ts` re-exports from `./schema/index`

All 58 existing imports from `@/core/database/schema` work unchanged.

## Affected Areas

| Area | Impact |
|------|--------|
| `src/core/database/schema.ts` | Modified — barrel re-export |
| `src/core/database/schema/enums.ts` | New — all pgEnums |
| `src/core/database/schema/profiles.ts` | New — profiles |
| `src/core/database/schema/businesses.ts` | New — businesses domain (8 tables) |
| `src/core/database/schema/products.ts` | New — products domain (4 tables) |
| `src/core/database/schema/chat.ts` | New — chat domain (2 tables) |
| `src/core/database/schema/orders.ts` | New — orders/payments domain (7 tables) |
| `src/core/database/schema/notifications.ts` | New — notifications |
| `src/core/database/schema/imports.ts` | New — import jobs + rows |
| `src/core/database/schema/verification.ts` | New — verification OTPs |
| `src/core/database/schema/relations.ts` | New — all relations |
| `src/core/database/schema/types.ts` | New — type exports + helper |
| `src/core/database/schema/index.ts` | New — barrel file |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Circular imports between domain files | High | Relations in separate file importing tables lazily |
| Missing export breaks existing import | Medium | `tsc --noEmit` + verify all 58 import sites |
| Drizzle relation resolution ordering | Low | Relations file imports tables; Drizzle resolves lazily |

## Rollback Plan

`git checkout src/core/database/schema.ts && Remove-Item -Recurse src/core/database/schema/`. Every import returns to original state immediately.

## Dependencies

None.

## Success Criteria

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test:unit` passes (all existing tests)
- [ ] All 58 existing imports resolve correctly
- [ ] Lines moved, not added or removed (~1344 deleted, ~1344 added)
