# Order Access Hardening — Deployment Handoff Checklist

Status: `develop` carries full R19–R25 (tests 230 files / 2557, type-check 0, lint baseline).
All code is merged on develop. `main` = fe9b87e (18-sep): **28 commits behind** — the prod
release will ship whatsapp coexistence + order-number-integrity + order-access v2 together.

Remaining steps are OPERATIONAL (Vercel envs + prod SQL + external webhook config) — owner: human.

---

## 0. Release `develop` → `main`

- [ ] Create PR `develop` → `main` (28 commits, all CI green on develop).
- [ ] Merge, wait for Vercel prod deploy to finish.

Everything below assumes the release is LIVE in prod. The only item that must be set
BEFORE the release reaches prod is `ORDER_ACCESS_COOKIE_SECRET` (Section 1).

---

## 1. Pre-deploy gate: `ORDER_ACCESS_COOKIE_SECRET` (BLOCKING)

**Why it blocks:** `src/config/env.ts:56` defaults it to `''`; `:127-131` only `console.warn`s, so
failure is silent at boot. An unset secret makes `verifyOrderAccessCookie` return `false`
unconditionally (`src/lib/orderAccessCookie.ts:112-113`) → **every legitimate buyer fails R19**
(orders forever in PII-free projection, mutations denied). Fails CLOSED.

**This is the ONLY new secret introduced by R19–R25.**

**Status: DONE ✅ (2026-10-09)** — generated `openssl rand -hex 32` equivalent (64 hex chars),
set the SAME value in Production (sensitive), Preview (sensitive), Development (non-sensitive —
Vercel does not allow `--sensitive` on Development), and local `.env`. Verified
Development == `.env` local via `vercel env pull --environment development` (prod/preview
values are masked as `[SENSITIVE]` on pull by design).

**Remaining (after release):**

1. Deploy to **preview**, smoke-test a full `verifyOrderAccess` → mutate round trip
   (order page upgrade + an action that hits the mutation gate).
2. Promote only after the smoke test passes.

**Rollback note:** if the secret is the problem, rolling code back does NOT restore access —
unset/deploy the secret first.

---

## 2. Prod env vars (complete master list)

Confirmed by reading `src/config/env.ts` + grep of all `process.env` reads. Vercel projects
usually already have most of these. **The ✗ rows are used by code but MISSING from
`.env.example` — double-check they exist in prod.**

### REQUIRED (non-null `!` in env.ts, or rejects in prod)

| Env var                         | In .env.example? | Notes                                                                                                                                                                                        |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ORDER_ACCESS_COOKIE_SECRET`    | yes              | NEW from R19–R25. Same value in Prod/Preview/Dev.                                                                                                                                            |
| `NEXT_PUBLIC_SUPABASE_URL`      | yes              |                                                                                                                                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes              |                                                                                                                                                                                              |
| `SUPABASE_SERVICE_ROLE_KEY`     | yes              |                                                                                                                                                                                              |
| `JSON_TOKEN`                    | yes              | JSON.pe RUC/DNI                                                                                                                                                                              |
| `JSON_WSP_INSTANCE`             | ✗ NO             | ~~env.ts:23~~ — **DEAD CONFIG: read in env.ts but used NOWHERE in codebase** (checked 2026-10-09). Not in `.env.example`. NOT NEEDED; skip. Revisit only if a JSON.pe WhatsApp feature ships |
| `TWILIO_ACCOUNT_SID`            | yes              | WhatsApp OTP                                                                                                                                                                                 |
| `TWILIO_AUTH_TOKEN`             | yes              |                                                                                                                                                                                              |
| `TWILIO_WHATSAPP_NUMBER`        | yes              |                                                                                                                                                                                              |
| `TWILIO_SERVICE_SID`            | yes              | Twilio Verify                                                                                                                                                                                |
| `JSONPE_SMS_TOKEN`              | yes              | SMS order notifications                                                                                                                                                                      |
| `RESEND_API_KEY`                | yes              | transactional email                                                                                                                                                                          |
| `RESEND_FROM_EMAIL`             | yes              |                                                                                                                                                                                              |
| `ENCRYPTION_KEY`                | ✗ NO             | src/utils/crypto.ts:21-22 — encrypts seller gateway keys; **throws in prod if unset** — ✅ DONE 2026-10-09 (generated, set Prod/Preview/Dev + local .env)                                    |
| `DATABASE_URL`                  | yes              | src/core/database/client.ts:14-18                                                                                                                                                            |
| `CULQI_WEBHOOK_SECRET`          | ✗ NO             | HMAC SIGNATURE path only (app/api/webhooks/culqi/route.ts:75-115) — used by API-created webhooks. **CulqiPanel does NOT send HMAC** (route.ts:31-33) → see `CULQI_WEBHOOK_USER/PASS` below   |

### OPTIONAL (safe fallback, but set in prod for real behavior)

| Env var                                                                         | In .env.example? | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                                                           | yes              | prod domain                                                                                                                                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_AUTH_ORIGIN`                                                       | yes              | prod: `https://storelite.app`                                                                                                                                                                                                                                                                                                                                                                           |
| `SHARED_COOKIE_DOMAIN`                                                          | yes              | prod: `.storelite.app` (cross-subdomain cookies)                                                                                                                                                                                                                                                                                                                                                        |
| `JSONPE_API_BASE_URL`                                                           | no               | has sane default                                                                                                                                                                                                                                                                                                                                                                                        |
| `CULQI_WEBHOOK_USER` / `CULQI_WEBHOOK_PASS`                                     | yes              | **REQUIRED for prod** — CulqiPanel authenticates webhooks with Basic Auth ONLY (route.ts:34-56, 166-170). Without them (or `CULQI_WEBHOOK_SECRET`) prod rejects webhook with 401 (route.ts:179-181). ✅ DONE 2026-10-09 Prod/Preview/Dev + local .env — ⚠️ MUST match the credentials configured in the Culqi panel (user configured it in panel? VERIFY) — ⚠️ PASS is weak, user offered to strengthen |
| `CRON_SECRET`                                                                   | yes              | crons 401 if unset                                                                                                                                                                                                                                                                                                                                                                                      |
| `PLATFORM_ADMIN_IDS`                                                            | yes              | fail-closed allowlist — NOT an external service: comma-separated Supabase Auth User UIDs (src/config/env.ts:60-63). ✅ DONE 2026-10-09 (1 UID, Prod/Preview/Dev + local .env)                                                                                                                                                                                                                           |
| `SASS_API_KEY`                                                                  | yes              | service endpoints                                                                                                                                                                                                                                                                                                                                                                                       |
| `NEXT_PUBLIC_META_PIXEL_ID` / `META_CAPI_ACCESS_TOKEN` / `META_TEST_EVENT_CODE` | yes              | tracking                                                                                                                                                                                                                                                                                                                                                                                                |
| `YCLOUD_API_KEY`                                                                | ✗ NO             | WhatsApp Embedded Signup — ✅ DONE 2026-10-09 (copied from .env → Prod/Preview/Dev)                                                                                                                                                                                                                                                                                                                     |
| `YCLOUD_WABA_ID`                                                                | ✗ NO             | — ✅ DONE 2026-10-09                                                                                                                                                                                                                                                                                                                                                                                    |
| `YCLOUD_WEBHOOK_SECRET`                                                         | ✗ NO             | prod webhook rejects if unset — ✅ DONE 2026-10-09 (still needs YCloud dashboard webhook config)                                                                                                                                                                                                                                                                                                        |
| `NEXT_PUBLIC_YCLOUD_FB_APP_ID` / `_CONFIG_ID` / `_SOLUTION_ID`                  | yes              | Meta partner config                                                                                                                                                                                                                                                                                                                                                                                     |
| `WHATSAPP_RATE_LIMIT_PER_WINDOW` / `_WINDOW_MINUTES`                            | no               | defaults 100 / 5 min                                                                                                                                                                                                                                                                                                                                                                                    |
| `ENABLE_AUTO_DEACTIVATION`                                                      | ✗ NO             | gates cron deactivation sweeps — ✅ DONE 2026-10-09 (`true` Prod/Preview/Dev + local .env)                                                                                                                                                                                                                                                                                                              |

### Feature flags to decide for prod

- `ORDER_FLOW_V2` — env.ts defaults `false`, `.env.example` says `true`. **Set `true` in prod** (order v2 flow is the shipped behavior).
- `CULQI_ENFORCE_LIVE_KEYS` — set `true` in prod (reject test keys).
- `FEATURE_SUBDOMAIN_REWRITE` — leave `false` unless subdomain phase 2 ships.
- `OTP_HASH_SECRET` — REQUIRED-in-practice: strong random string (dev fallback is a known string — DO NOT ship that to prod).

---

## 3. Prod migrations (SQL) — 3 files, in order

**Status: ALL DONE ✅ (2026-10-09)** — applied in prod via Supabase SQL editor and verified:

- #1 `0025_lonely_firebird.sql` — 4 whatsapp tables present; `whatsapp_channels` has all
  10 columns; **23/23 indexes** and **5/5 FKs** verified (`missing_indexes=0`, `fk=5`).
  ⚠️ Migration comment said "20 indexes" but the actual file creates 23.
- #2 `0048_whatsapp_connection_status.sql` — `connection_status text NOT NULL` present.
- #3 `0048_payments_order_number_integrity.sql` — 4/4 verify checks PASS (NOT NULL, unique
  index, trigger, function).

**All three are hand-written/manual (not drizzle journal-tracked). Run via Supabase SQL editor
or `scripts/apply-migration.mjs` — but do NOT trust apply-migration.mjs success alone; verify
after each.**

| #   | File                                                  | What it does                                                                                                        | Order                         | Re-runnable?                            |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------- |
| 1   | `migrations/0025_lonely_firebird.sql`                 | Creates `whatsapp_channels`, `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_templates` + FKs + 20 indexes | MUST run before 0048_whatsapp | ⚠️ NO (bare CREATE TABLE)               |
| 2   | `migrations/0048_whatsapp_connection_status.sql`      | `ALTER TABLE whatsapp_channels ADD COLUMN connection_status` + backfill active→connected                            | after #1                      | ⚠️ NO (ADD COLUMN no IF NOT EXISTS)     |
| 3   | `migrations/0048_payments_order_number_integrity.sql` | Backfill NULL order_number → NOT NULL + UNIQUE + immutable trigger                                                  | independent (any time)        | ⚠️ NO (CREATE TRIGGER no IF NOT EXISTS) |

**Check first:** if prod already has `whatsapp_channels` (out-of-band manual apply), skip #1
and only run #2. Verify: `select count(*) from whatsapp_channels;`

**After #3:** run `scripts/verify-order-number-integrity.sql` right away; expect all PASS
(0 NULL, 0 invalid pattern, 0 duplicates).

**Migration contract #3:** `BEGIN;` `pg_advisory_xact_lock(4800048)` → backfill NULL
(`'ORD-' || 12 uppercase hex`, mirrors `src/core/payments/orderNumber.ts`) → format scan
(raises on invalid) → constrains (NOT NULL + UNIQUE + immutable trigger). PROD has 0 rows
per its header — DEV verified with 89 rows.

> ⚠️ **Prefix collision warning:** there are two `0048_*` files and three `0025_*` files.
> They are NOT journal-tracked so drizzle won't re-run them, but be careful when applying —
> number prefix alone is NOT unique. Apply by exact filename in the order above.

---

## 4. Crons + webhooks (external config)

### Cron endpoints (both 401 without `CRON_SECRET`)

- `GET /api/cron/order-timeouts` — every 15 min (runs deactivation sweeps when `ENABLE_AUTO_DEACTIVATION=true`).
- `GET /api/cron/check-plans` — daily 08:00.
- ~~`vercel.json` has NO `crons` key → schedule lives in Vercel dashboard or Supabase `pg_cron`~~.

> ⚠️ **DO NOT IMPLEMENT CRONS (decision 2026-10-09):** the crons are planned for REMOVAL
> entirely. Replacement: advanced expiration-date data flow (see
> `exploration-auto-deactivation-complaints.md` at repo root — verify when this part is
> revisited). Do not add `crons` key to vercel.json, do not schedule in dashboard.

### Webhooks to configure

| Endpoint                    | Where to configure | Auth                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/webhooks/culqi`  | Culqi panel        | Basic (`CULQI_WEBHOOK_USER/PASS`) — **panel does NOT offer HMAC**, so Basic is the real path — ✅ DONE 2026-10-09 (user created `order.status.changed`, pass 20ch synced Prod/Preview/Dev + local)                                                                                                                                                                                                                                                         |
| `POST /api/webhooks/ycloud` | YCloud dashboard   | `YCLOUD_WEBHOOK_SECRET` (prod-required) — ✅ DONE 2026-10-09 (endpoint `6ab1cc94b7fddb53c2045b29`, status=active, URL `https://storelite.app/api/webhooks/ycloud`, secret synced Prod/Preview/Dev + local. NOTE: user selected ALL ~20 events; our route handles only the 4 (`whatsapp.inbound_message.received`, `whatsapp.message.updated`, `whatsapp.template.reviewed`, `whatsapp.phone_number.updated`); extras hit `default:` → harmless log noise.) |

> ✅ **CULQI WEBHOOK — CONCLUSION (2026-10-09, verified vs code + Culqi docs):**
> **Register EXACTLY ONE webhook: `order.status.changed`.** The user does NOT need
> the 3-4 separate webhooks they feared.
>
> - The happy path (buyer completes payment in-session) does NOT need any webhook:
>   the app's `charge` route reads the Culqi order directly
>   (`getCulqiOrder`/`isCulqiOrderPaid`, charge/route.ts:432-448) and marks
>   `paymentOrders.status='paid'` + writes `payments` itself (charge/route.ts:540-582).
> - `order.status.changed` is OBLIGATORY for async/unattended updates (PagoEfectivo /
>   billeteras, which "pueden pagar muchas horas después") and for `expired`/
>   `cancelled`. Culqi docs (ordenes-de-pago/resumen) state it explicitly.
> - What the user currently has, `order.creation.succeeded`, is NOT handled by our
>   route → falls to `default:`, logged and ignored.
> - Refund events (`refund.creation.succeeded`/`refund.creation.failed`): register
>   ONLY if refunds are processed from the Culqi panel. Not needed for launch.
> - ⚠️ LATENT GAP: our route's `charge.paid`/`charge.failed` cases use names Culqi
>   does NOT emit — real charge events are `charge.creation.succeeded`/
>   `charge.creation.failed`. Harmless today (payments row already written by the
>   charge route); revisit only if the charge webhook path is ever relied upon.
> - Panel = 1 webhook per event, but ONE event (`order.status.changed`) is sufficient.
>   Same URL, same Basic Auth (`CULQI_WEBHOOK_USER/PASS`).

---

## 5. Post-deploy smoke (recommended)

- [x] Confirm `ORDER_ACCESS_COOKIE_SECRET` is set in prod env (Vercel dashboard). ✅ done 2026-10-09 (Prod/Preview/Dev + local)
- [ ] Order page cookie upgrade round trip on prod: open `verifyOrderAccess` → mutate → refresh keeps full PII view.
- [x] `whatsapp_channels` exists and has `connection_status` column. ✅ applied + verified in prod (0048_whatsapp_connection_status)
- [x] payments rows carry `order_number` (NOT NULL). ✅ applied + verified in prod (0048_payments_order_number_integrity)
- [ ] ~~Cron endpoints respond 401 without token, 200 with token~~ — crons planned for removal (see Section 4).
- [ ] Culqi webhook delivers a test event. (Route live since v1.1.0: `GET /api/webhooks/culqi` → 405; real event delivery pending a test payment.)

---

## Quick reference

| Item                                | Value                                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret env (NEW)                    | `ORDER_ACCESS_COOKIE_SECRET` (all Vercel envs, same value)                                                                                                                                          |
| Missing from .env.example checklist | `ENCRYPTION_KEY`, `CULQI_WEBHOOK_SECRET`, `YCLOUD_API_KEY`, `YCLOUD_WABA_ID`, `YCLOUD_WEBHOOK_SECRET`, `JSON_WSP_INSTANCE`, `ENABLE_AUTO_DEACTIVATION`                                              |
| Migrations (order)                  | `0025_lonely_firebird.sql` → `0048_whatsapp_connection_status.sql` → `0048_payments_order_number_integrity.sql`                                                                                     |
| Verify                              | `scripts/verify-order-number-integrity.sql`                                                                                                                                                         |
| Prod DB pooler                      | port 6543 (Supabase)                                                                                                                                                                                |
| Generator                           | `openssl rand -hex 32`                                                                                                                                                                              |
| Order number pattern                | `^ORD-[A-Za-z0-9_-]{8,20}$`                                                                                                                                                                         |
| Crons                               | ~~/api/cron/order-timeouts (15m), /api/cron/check-plans (daily)~~ — DO NOT IMPLEMENT: planned for removal, replaced by advanced expiry-date data flow (exploration-auto-deactivation-complaints.md) |
| Webhooks                            | `/api/webhooks/culqi`, `/api/webhooks/ycloud`                                                                                                                                                       |

---

## 6. Release status — v1.1.0 (2026-10-10)

- **PR #224** `develop → main` merged (merge commit `254c712`), closes issue #223.
- **Tag + GitHub Release**: `v1.1.0` (Latest) — https://github.com/DevKitTop/Store-Lite-EIRL/releases/tag/v1.1.0
- **Deploy**: Vercel Production Ready (~2 min after merge).
- **Smoke test**: `https://storelite.app/` → 200; `/api/webhooks/culqi` → 405; `/api/webhooks/ycloud` → 405 (routes live in prod).
- **Fresh prod-readiness review**: READY_WITH_CAVEATS — 0 critical; all 45 `process.env` reads classified (38 SET, 8 OPTIONAL, 0 MISSING-REQUIRED).

### Post-release tasks (agreed with user)

| #   | Task                          | Detail                                                                                                                                                                                                                                               |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Set Meta Embedded Signup envs | `NEXT_PUBLIC_YCLOUD_FB_APP_ID`, `NEXT_PUBLIC_YCLOUD_FB_CONFIG_ID`, `NEXT_PUBLIC_YCLOUD_FB_SOLUTION_ID` — missing in all Vercel envs + local `.env`; pair-code fallback active until set. Requires the IDs from Meta/WhatsApp Embedded Signup config. |
| 2   | Decide `CULQI_WEBHOOK_SECRET` | Not in Vercel; HMAC path in `route.ts:76` fails closed (401). Dormant because CulqiPanel only supports Basic Auth. Set it if a future panel adds HMAC, else ignore.                                                                                  |
| 3   | Remove `JSON_WSP_INSTANCE`    | Dead config (`env.ts:23`, read with non-null assertion but never consumed) — remove the entry to kill the trap.                                                                                                                                      |
| 4   | Cosmetic cleanup              | UTF-8 BOM in `env.ts:1`; mojibake em-dashes in comments (`env.ts:90`, `url.ts`); stale drizzle journal at idx 24 (pre-existing pattern — migrations run manually, not via `drizzle-kit migrate`).                                                    |
