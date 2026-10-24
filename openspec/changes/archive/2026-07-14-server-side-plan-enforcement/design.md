# Design: Server-side plan enforcement in settings actions

## Technical Approach

Replace the client-trusted `plan` parameter in all 7 server actions with a server-side `getBusinessEntitlements(businessId)` call. Each action reads the true plan from the database instead of trusting the client. No new abstractions — follow the pattern already established in `src/features/storage/actions/products.ts` (lines 185-201).

The import path already exists in the codebase: `import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements'`.

## Architecture Decisions

### Decision: Inline `getBusinessEntitlements` vs. shared helper

| Option | Tradeoff |
|--------|----------|
| **Inline** (chosen) | Only 2 distinct check patterns across 7 actions. Inlining keeps each action self-contained and consistent with existing patterns in `products.ts`. No extra indirection. |
| `requirePaidPlan(businessId)` helper | Would wrap 1-2 lines of code. Adds a function to find, maintain, and understand. Over-engineering for 3 callers with slightly different error messages. |

### Decision: `hasPaymentGateway` for `updateCulqiCredentials`

| Option | Tradeoff |
|--------|----------|
| **`entitlements.hasPaymentGateway`** (chosen) | Semantically correct. If a future plan adds payment gateway support, this check adapts automatically. |
| Manual `plan === 'business_pro' \|\| plan === 'enterprise_ai'` | Brittle — requires updating this check whenever a new plan tier adds payments. |

## Per-Action Plan

| Action | Entitlement Check | Has `requireAccessOnId`? | Param Change | Error Message |
|--------|-------------------|--------------------------|--------------|---------------|
| `updateBusinessSlug` | `entitlements.plan !== 'basico'` | ✅ `business.edit` | Remove `plan` | "Funcion disponible solo para planes superiores." |
| `toggleBusinessActive` | `entitlements.plan !== 'basico'` | ✅ `business.edit` | Remove `plan` | "Funcion disponible solo para planes superiores." |
| `updateBusinessSEO` | `entitlements.plan !== 'basico'` | ✅ `seo.edit` | Remove `plan` | "Funcion disponible solo para planes superiores." |
| `updateStorefrontLayout` | `entitlements.plan !== 'basico' && entitlements.plan !== 'emprendedor'` | ✅ `storefront.edit` | Remove `plan` | "Funcion disponible solo para planes con personalizacion de storefront." |
| `updateStorefrontTheme` | `entitlements.plan !== 'basico' && entitlements.plan !== 'emprendedor'` | ✅ `storefront.edit` | Remove `plan` | "Funcion disponible solo para planes con personalizacion de storefront." |
| `clearStorefrontTheme` | `entitlements.plan !== 'basico' && entitlements.plan !== 'emprendedor'` | ✅ `storefront.edit` | Remove `plan` | "Funcion disponible solo para planes con personalizacion de storefront." |
| `updateCulqiCredentials` | `!entitlements.hasPaymentGateway` | ✅ `business.edit` | Remove `plan` | "La configuracion de pagos solo esta disponible en planes premium." |

**Order invariant**: All actions call `requireAccessOnId` BEFORE the entitlement check — correct. The `getBusinessEntitlements` call should sit between `requireAccessOnId` and the entitlement `if` block.

## Data Flow

```
Client Component
  ── (no plan arg) ──→ Server Action
                          ├── requireAccessOnId(businessId, permission)
                          ├── const entitlements = await getBusinessEntitlements(businessId)
                          ├── if (entitlements.plan check) → reject
                          └── else → proceed with business logic
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `app/[slug]/settings/actions.ts` | Modify | 7 actions: drop `plan` param, add `getBusinessEntitlements` call + import |
| `app/[slug]/settings/components/SettingsClient.tsx` | Modify | 3 call sites: remove `entitlements.plan` arg (lines 223, 237, 1158) |
| `app/[slug]/settings/components/StorefrontThemeEditor.tsx` | Modify | 2 call sites: remove `entitlements.plan` arg (lines 59, 65) |
| `app/[slug]/settings/components/PaymentsConfig.tsx` | Modify | 1 call site: remove `entitlements.plan` arg (line 56) |
| `app/[slug]/components/StorefrontEditor.tsx` | Modify | 1 call site (line 283): remove `plan` prop from interface, remove `plan \|\| 'business_pro'` fallback |

## Call Site Pattern — Before / After

**Before** (SettingsClient.tsx, L223):
```typescript
const res = await updateBusinessSlug(business.id, newSlug, entitlements.plan);
```

**After**:
```typescript
const res = await updateBusinessSlug(business.id, newSlug);
```

**Before** (StorefrontEditor.tsx, L283):
```typescript
const result = await updateStorefrontTheme(
  business.id, business.slug, storefrontTheme,
  plan || 'business_pro', scheme,
);
```

**After** (remove `plan` from props + call):
```typescript
const result = await updateStorefrontTheme(
  business.id, business.slug, storefrontTheme, scheme,
);
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | Each action rejects the correct plan tiers | Mock `getBusinessEntitlements` via existing patterns |
| Type-check | No TS errors after removing `plan` params/args | `pnpm type-check` |
| Integration | `getBusinessEntitlements` returns correct data | Already tested independently — no change needed |

## Migration / Rollout

No migration required. Old `plan` parameter is removed entirely — no backward compatibility needed since server actions are not public API.

## Open Questions

None.
