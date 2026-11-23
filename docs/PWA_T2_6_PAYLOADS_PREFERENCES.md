# T2.6 - Generic payloads and preferences (design)

**Status:** Proposed design for P2 (Web Push). Not implemented.  
**Task:** `T2.6 Implement generic payloads and preferences` (`docs/PWA_RESEARCH.md`)  
**Depends on:** T0.3 (MVP category `pedidos` only; others inbox-only; generic payloads), T2.5 (fan-out/dedup and delivery context). Coordinates with T2.1 (subscription/preference storage extension point), T2.2 (subscription/settings API surface), T2.3 (worker display/click handling), T2.4 (sender payload/options), T2.7 (lifecycle/eligibility).  
**Gate:** Do not implement before P2 is unblocked (T0.6 legal approval/publication before launch, T2.1 migration applied/available, T2.4/T2.5 behavior aligned). No changes to inbox behavior/read-state (T0.4).

## Goals

- Ensure Web Push **payloads are generic and privacy-safe** (no sensitive notification `message`/`data` verbatim) while the durable in-app inbox remains the source of detail after authenticated navigation.
- Define **preference mapping to the existing notification category enum** (`chat`, `almacen`, `plan`, `pedidos`, `sistema`) with MVP opt-in limited to `pedidos` (T0.3), extensible for future categories without schema churn.
- Keep delivery **per eligible user/device** (T0.1) and **separate from shared inbox read-state** (T0.4).

## Payload policy (generic)

- **MVP enabled category:** `pedidos` only (T0.3). `chat`, `almacen`, `plan`, `sistema` produce in-app inbox notifications only (no push fan-out) until explicitly enabled by a future decision.
- **Content:** push payloads must not include customer names, chat previews, order amounts, payment details, or other sensitive/private fields currently present in some `notifications.message`/`notifications.data`. Use fixed, generic copy per category/type, e.g. "New order received" / localized equivalent, with no PII.
- **Structure (implementation-time, aligned with T2.3/T2.4):** minimal JSON such as `{ title, body, tag?, data: { url, category, notificationId? } }` where `data.url` is a safe same-origin internal path hint (e.g. business dashboard/orders area). The worker/app must treat `url` as a navigation hint only and **recheck authentication, membership, and authorization** on load; never auto-mark shared inbox read on receipt/click (T0.4).
- **Producer rule:** fan-out/sender builds payloads from trusted server-side context (category/type and target business/route), not by forwarding raw inbox `message`/`data`. Inbox rows remain unchanged.

## Preferences model (mapped to existing enum)

- **Enum source of truth:** `notification_category` (`chat`, `almacen`, `plan`, `pedidos`, `sistema`) as defined in `src/core/database/schema/enums.ts` and mirrored types. Preferences must map 1:1 to these categories (no parallel/ad-hoc category names).
- **MVP behavior:** push opt-in is explicit (user action, T2.2/T2.3) and effectively enables `pedidos` for eligible memberships/devices per product/UX decision. Non-`pedidos` categories are not push-deliverable in MVP regardless of stored preference shape.
- **Extensibility (P2 implementation detail, per T2.1/T2.6):** support future per-category opt-in/out without breaking base schema, e.g. per-subscription/device category flags or a `push_subscription_*_preferences` table keyed by subscription (and/or user+business) + `category` with enabled/disabled and timestamps. Membership/authorization must be validated at preference write time and at send time (T2.4/T2.5/T2.7).
- **Scope:** preferences control push delivery only; they must not change in-app inbox creation, visibility, or shared read/dismiss state.

## Settings surface (UX, implementation-time)

- Provide a seller/team settings entry to manage push enablement (and future per-category toggles mapped to the enum) with clear privacy/permission context, consistent with T0.6 and unsupported/denied/iOS Home Screen states (T1.5/T2.3). Revocation must be available in-app and reflected promptly (T2.2/T2.7).
- MVP UI can present a single `pedidos` push toggle; UI must not imply other categories are push-enabled until supported.

## Acceptance mapping (T2.6)

- **Payload is generic:** no sensitive details in push content; details require authenticated, authorized navigation.
- **Preferences map to the existing category enum:** `notification_category` values are the canonical keys; MVP limits delivery to `pedidos`.
- **Inbox unchanged:** no changes to inbox creation, filtering, or shared read-state semantics.

## Open items / implementation notes

- Finalize preference storage shape and migration (coordinate with T2.1 next-free prefix and T2.2 API).
- Finalize generic copy per type/category and localization approach.
- Confirm settings placement and exact UX copy with T0.6-approved privacy text.
- Tests at implementation: unit-test payload builder rejects/omits sensitive fields and maps categories correctly; preference filtering in fan-out uses enum keys and MVP `pedidos` gating.
