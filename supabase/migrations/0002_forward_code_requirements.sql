-- Tables required by the current application code but absent from the
-- staging baseline. Detected by catalog diff on 2026-11-01.
--
-- Evidence:
--   src/core/payments/rateLimitShared.ts  -> rate_limit_windows
--   src/core/payments/webhookDedup.ts     -> webhook_events
--
-- Without these tables both features fail at runtime. rateLimitShared.ts
-- swallows the error and fails open, so staging currently runs without
-- effective rate limiting.

create table if not exists "public"."webhook_events" (
  "event_id" text not null,
  "event_type" text,
  "processed_at" timestamp with time zone not null default now(),
  "expires_at" timestamp with time zone not null,
  constraint "webhook_events_pkey" primary key ("event_id")
);

create index if not exists "idx_webhook_events_expires_at" on "public"."webhook_events" using btree ("expires_at");
create index if not exists "idx_webhook_events_processed_at" on "public"."webhook_events" using btree ("processed_at");

create table if not exists "public"."rate_limit_windows" (
  "key" text not null,
  "window_start" timestamp with time zone not null,
  "count" integer not null default 0,
  "updated_at" timestamp with time zone not null default now(),
  "expires_at" timestamp with time zone not null,
  constraint "rate_limit_windows_key_window_start_pk" primary key ("key", "window_start")
);

create index if not exists "idx_rate_limit_windows_expires_at" on "public"."rate_limit_windows" using btree ("expires_at");
create index if not exists "idx_rate_limit_windows_key" on "public"."rate_limit_windows" using btree ("key");
create index if not exists "idx_rate_limit_windows_window_start" on "public"."rate_limit_windows" using btree ("window_start");
