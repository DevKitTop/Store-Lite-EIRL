# Spec: Server-side plan enforcement in settings actions

## 1. Requirements

### Action 1: `updateBusinessSlug`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, newSlug, plan)` |
| **Target signature** | `(businessId, newSlug)` — drops `plan` |
| **Current plan check** | `plan === 'basico'` → error |
| **Target plan check** | `entitlements.plan === 'basico'` → error after `getBusinessEntitlements(businessId)` |
| **Error message** | `'Funcion disponible solo para planes superiores.'` |
| **Special conditions** | None |
| **Plan guard type** | Single plan exclusion (`basico`) |

### Action 2: `toggleBusinessActive`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, currentIsActive, plan)` |
| **Target signature** | `(businessId, currentIsActive)` — drops `plan` |
| **Current plan check** | `plan === 'basico'` → error |
| **Target plan check** | `entitlements.plan === 'basico'` → error after `getBusinessEntitlements(businessId)` |
| **Error message** | `'Funcion disponible solo para planes superiores.'` |
| **Special conditions** | None |
| **Plan guard type** | Single plan exclusion (`basico`) |

### Action 3: `updateBusinessSEO`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, seoData, plan)` |
| **Target signature** | `(businessId, seoData)` — drops `plan` |
| **Current plan check** | `plan === 'basico'` → error |
| **Target plan check** | `entitlements.plan === 'basico'` → error after `getBusinessEntitlements(businessId)` |
| **Error message** | `'Funcion disponible solo para planes superiores.'` |
| **Special conditions** | None |
| **Plan guard type** | Single plan exclusion (`basico`) |

### Action 4: `updateStorefrontLayout`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, slug, layout, plan)` |
| **Target signature** | `(businessId, slug, layout)` — drops `plan` |
| **Current plan check** | `plan === 'basico' \|\| plan === 'emprendedor'` → error |
| **Target plan check** | `entitlements.plan === 'basico' \|\| entitlements.plan === 'emprendedor'` |
| **Error message** | `'Funcion disponible solo para planes con personalizacion de storefront.'` |
| **Special conditions** | Could also use `!entitlements.canCustomizeStorefront` check, but the proposal preserves exact same plan logic. Use `entitlements.plan` to avoid behavioral changes. |
| **Plan guard type** | Multi-plan exclusion (`basico`, `emprendedor`) |

### Action 5: `updateStorefrontTheme`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, slug, storefrontTheme, plan, themeMode?)` |
| **Target signature** | `(businessId, slug, storefrontTheme, themeMode?)` — drops `plan` |
| **Current plan check** | `plan === 'basico' \|\| plan === 'emprendedor'` → error |
| **Target plan check** | `entitlements.plan === 'basico' \|\| entitlements.plan === 'emprendedor'` |
| **Error message** | `'Funcion disponible solo para planes con personalizacion de storefront.'` |
| **Special conditions** | Could also use `!entitlements.canCustomizeStorefront` check, but the proposal preserves exact same plan logic. Use `entitlements.plan` to avoid behavioral changes. |
| **Plan guard type** | Multi-plan exclusion (`basico`, `emprendedor`) |

### Action 6: `clearStorefrontTheme`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, slug, plan)` |
| **Target signature** | `(businessId, slug)` — drops `plan` |
| **Current plan check** | `plan === 'basico' \|\| plan === 'emprendedor'` → error |
| **Target plan check** | `entitlements.plan === 'basico' \|\| entitlements.plan === 'emprendedor'` |
| **Error message** | `'Funcion disponible solo para planes con personalizacion de storefront.'` |
| **Special conditions** | Could also use `!entitlements.canCustomizeStorefront` check, but the proposal preserves exact same plan logic. Use `entitlements.plan` to avoid behavioral changes. |
| **Plan guard type** | Multi-plan exclusion (`basico`, `emprendedor`) |

### Action 7: `updateCulqiCredentials`

| Property | Value |
|----------|-------|
| **Current signature** | `(businessId, publicKey, secretKey, plan)` |
| **Target signature** | `(businessId, publicKey, secretKey)` — drops `plan` |
| **Current plan check** | `plan !== 'business_pro' && plan !== 'enterprise_ai'` → error |
| **Error message** | `'La configuracion de pagos solo esta disponible en planes premium.'` |
| **Special conditions** | **DIFFERENT from other actions**: This action should check `entitlements.hasPaymentGateway` instead of comparing plan strings. `hasPaymentGateway` is `false` for `basico` and `emprendedor`, `true` for `business_pro` and `enterprise_ai`. This is more semantic and matches the entitlements model used elsewhere in the codebase (e.g., `PaymentsConfig.tsx` already checks `['business_pro', 'enterprise_ai'].includes(entitlements.plan)` as a UI gate). |
| **Target plan check** | `!entitlements.hasPaymentGateway` → error |
| **Plan guard type** | Uses `hasPaymentGateway` entitlement flag (semantic check) |

### Import required

All 7 actions need:
```ts
import { getBusinessEntitlements } from '@/core/entitlements';
```

The import already exists for `requireAccessOnId`, so no structural conflicts.

### Pattern for all actions

```ts
// Replace:
if (plan === 'basico') { ... }

// With:
const entitlements = await getBusinessEntitlements(businessId);
if (entitlements.plan === 'basico') { ... }
```

The `getBusinessEntitlements` call should be placed AFTER the `requireAccessOnId` guard (to fail fast on auth) but BEFORE any business logic.

---

## 2. Call site changes

### 2.1 `SettingsClient.tsx` — `BusinessSection`

**Current calls:**

```ts
// Line 223
const res = await updateBusinessSlug(business.id, newSlug, entitlements.plan);

// Line 237
const res = await toggleBusinessActive(business.id, business.isActive, entitlements.plan);
```

**Changes:**
- Remove third argument `entitlements.plan` from both calls

**Note:** `canEditSlug = entitlements.plan !== 'basico'` (line 81) is used for UI gating (disabling the switch/hiding edit button). This stays — it's UX, not security.

---

### 2.2 `SettingsClient.tsx` — `StorefrontSectionEditor`

**Current call (lines 918-923):**

```ts
const result = await updateStorefrontLayout(
  business.id,
  business.slug,
  layout,
  entitlements.plan,   // ← remove this
);
```

**Changes:**
- Remove the `entitlements.plan` argument

---

### 2.3 `SettingsClient.tsx` — `SEOSection`

**Current call (lines 1158-1168):**

```ts
const res = await updateBusinessSEO(
  business.id,
  { ...formData, seoKeywords: ... },
  entitlements.plan,   // ← remove this
);
```

**Changes:**
- Remove the `entitlements.plan` argument

---

### 2.4 `StorefrontThemeEditor.tsx`

**Current calls (lines 59, 61-67):**

```ts
// Line 59
result = await clearStorefrontTheme(business.id, business.slug, entitlements.plan);

// Lines 61-67
result = await updateStorefrontTheme(
  business.id,
  business.slug,
  storefrontTheme,
  entitlements.plan,   // ← remove this
  scheme,
);
```

**Changes:**
- Remove `entitlements.plan` from both calls

---

### 2.5 `PaymentsConfig.tsx`

**Current call (lines 52-57):**

```ts
const result = await updateCulqiCredentials(
  business.id,
  publicKey,
  secretKey,
  entitlements.plan,   // ← remove this
);
```

**Changes:**
- Remove the `entitlements.plan` argument

**Note:** `isPremiumPlan = ['business_pro', 'enterprise_ai'].includes(entitlements.plan)` (line 77) is used for UI gating (hiding the payments section). This stays — it's UX, not security.

---

### 2.6 `StorefrontEditor.tsx` (public page)

**Current call (lines 279-285):**

```ts
const result = await updateStorefrontTheme(
  business.id,
  business.slug,
  storefrontTheme,
  plan || 'business_pro',   // ← remove this — also a trust gap
  scheme,
);
```

**Changes:**
- Remove the `plan || 'business_pro'` argument (the action will self-enforce)

**TypeScript changes:**
- Remove `plan?: string` from `StorefrontEditorProps` interface (line 29)
- Remove `plan` from destructured props (line 69)
- The consumer `BusinessPageContent.tsx` already does NOT pass `plan` (line 696-704), so this is a safe removal — no consumer changes needed.

---

### Summary of client changes

| File | Calls affected | plan arg removed? |
|------|---------------|-------------------|
| `SettingsClient.tsx` - BusinessSection | `updateBusinessSlug`, `toggleBusinessActive` | ✅ yes |
| `SettingsClient.tsx` - StorefrontSectionEditor | `updateStorefrontLayout` | ✅ yes |
| `SettingsClient.tsx` - SEOSection | `updateBusinessSEO` | ✅ yes |
| `StorefrontThemeEditor.tsx` | `clearStorefrontTheme`, `updateStorefrontTheme` | ✅ yes |
| `PaymentsConfig.tsx` | `updateCulqiCredentials` | ✅ yes |
| `StorefrontEditor.tsx` | `updateStorefrontTheme` | ✅ yes + remove `plan` prop |

All other uses of `entitlements.plan` in client components are UI gating only and must remain unchanged.

---

## 3. Testing scenarios

### Scenario 1: Action called with `basico` plan

**Setup:** Business has `plan = 'basico'` in the database (no active subscription or subscription is `basico`).

**Expected behavior for all 7 actions:**
- `getBusinessEntitlements(businessId)` returns `{ plan: 'basico', hasPaymentGateway: false }`
- Action returns `{ success: false, error: '<appropriate error message>' }`
- No business data is modified

**Covers:** Security regression — blocking free-tier users is preserved.

### Scenario 2: Action called with expired subscription (should degrade to `basico`)

**Setup:** Business subscription exists but `planEndDate < now`.

**Expected behavior:**
- `getBusinessEntitlements` degrades to `basico` plan, logs warning
- Same error as Scenario 1 for all 7 actions
- No mutation occurs

**Covers:** The expiry fallback path in `getBusinessEntitlements` is correctly wired.

### Scenario 3: Action called with valid active premium plan

**Setup:** Business has an active `business_pro` or `enterprise_ai` subscription.

**Expected behavior for all 7 actions:**
- `getBusinessEntitlements` returns the correct plan
- Plan check passes for each action's specific logic
- Action proceeds and returns success or processes business logic normally

**Covers:** Regression — paying users are not blocked.

### Scenario 4: Direct RPC call with manipulated plan (security test)

**Setup:** Attacker calls the server action directly via fetch/RPC, passing `plan: 'business_pro'` in the body.

**Expected behavior:**
- The action no longer accepts `plan` parameter at all
- If the caller passes extra arguments, TypeScript enforces at build time (on the client), but direct RPC calls with extra args are simply ignored by the function
- The action reads `plan` exclusively from `getBusinessEntitlements(businessId)` — attacker's `plan` value is never used
- Same result as Scenario 1 for `basico` users, regardless of what the attacker sends

**Covers:** The core security fix — client-trusted `plan` is eliminated.

### Scenario 5: `updateCulqiCredentials` with `emprendedor` plan (detailed entitlement check)

**Setup:** Business has `plan = 'emprendedor'`, `entitlements.hasPaymentGateway = false`.

**Expected behavior:**
- Old code would pass the `plan !== 'business_pro' && plan !== 'enterprise_ai'` check and reject
- New code checks `!entitlements.hasPaymentGateway` → same rejection
- Returns `{ success: false, error: 'La configuracion de pagos solo esta disponible en planes premium.' }`

**Covers:** The semantic entitlement flag matches the old plan-string logic exactly for `emprendedor`.

### Scenario 6: `updateCulqiCredentials` with `business_pro` plan

**Setup:** Business has `plan = 'business_pro'`, `entitlements.hasPaymentGateway = true`.

**Expected behavior:**
- `!entitlements.hasPaymentGateway` is `false` → check passes
- Action proceeds to validate keys and update credentials

**Covers:** Premium user is not blocked.

---

## Appendix: Entitlement model reference

All plans and their `hasPaymentGateway` / `canCustomizeStorefront` flags (from `plans.ts`):

| Plan | `hasPaymentGateway` | `canCustomizeStorefront` |
|------|-------------------|------------------------|
| `basico` | `false` | `false` |
| `emprendedor` | `false` | `false` |
| `business_pro` | `true` | `true` |
| `enterprise_ai` | `true` | `true` |

Action guards mapped to semantic entitlements:

| Action | Current (plan string) | Semantic equivalent |
|--------|----------------------|-------------------|
| `updateBusinessSlug` | `plan === 'basico'` | N/A — slug restriction is not a semantic entitlement; keep plan-string check |
| `toggleBusinessActive` | `plan === 'basico'` | N/A — active toggle restriction is not a semantic entitlement; keep plan-string check |
| `updateBusinessSEO` | `plan === 'basico'` | Could use `!entitlements.seoEnabled` but plan-string check preserves exact behavior |
| `updateStorefrontLayout` | `basico` / `emprendedor` | Could use `!entitlements.canCustomizeStorefront` but plan-string preserves exact behavior |
| `updateStorefrontTheme` | `basico` / `emprendedor` | Could use `!entitlements.canCustomizeStorefront` but plan-string preserves exact behavior |
| `clearStorefrontTheme` | `basico` / `emprendedor` | Could use `!entitlements.canCustomizeStorefront` but plan-string preserves exact behavior |
| `updateCulqiCredentials` | `!business_pro && !enterprise_ai` | **Use `!entitlements.hasPaymentGateway`** — explicitly required |

**Decision:** Only `updateCulqiCredentials` switches to the semantic entitlement flag `hasPaymentGateway`. The other 6 actions keep plan-string comparisons against `entitlements.plan` to minimize behavioral risk.
