-- Baseline schema generated from staging (public schema).
-- Source: catalog introspection. Forward-only baseline.

-- Extensions
create extension if not exists "hypopg" with schema "extensions";
create extension if not exists "index_advisor" with schema "extensions";
create extension if not exists "pg_stat_statements" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "supabase_vault" with schema "vault";
create extension if not exists "uuid-ossp" with schema "extensions";

-- Enum types
create type "public"."appeal_status" as enum ('pending', 'approved', 'rejected');
create type "public"."complaint_score_tier" as enum ('verified', 'under_review', 'rejected');
create type "public"."contrast_level" as enum ('standard', 'medium', 'high');
create type "public"."deactivation_reason" as enum ('verified_complaints', 'incomplete_orders');
create type "public"."feedback_category" as enum ('bug', 'suggestion', 'question', 'other');
create type "public"."feedback_priority" as enum ('low', 'normal', 'high');
create type "public"."feedback_request_type" as enum ('support', 'feedback', 'complaint');
create type "public"."feedback_sender_type" as enum ('user', 'admin');
create type "public"."feedback_status" as enum ('open', 'in_progress', 'resolved', 'closed');
create type "public"."import_job_status" as enum ('pending', 'processing', 'completed', 'failed', 'cancelled');
create type "public"."import_row_status" as enum ('pending', 'processing', 'completed', 'error');
create type "public"."media_type" as enum ('image', 'video');
create type "public"."notification_category" as enum ('chat', 'almacen', 'plan', 'pedidos', 'sistema');
create type "public"."notification_type" as enum ('message_new', 'message_unread', 'stock_low', 'stock_out', 'plan_expiring', 'plan_expired', 'plan_upgraded', 'order_created', 'order_status_changed', 'order_shipped', 'order_finalization_requested', 'order_finalization_confirmed', 'order_finalization_rejected', 'order_auto_finalized', 'system');
create type "public"."order_attachment_type" as enum ('tracking', 'cip', 'invoice', 'photo', 'video', 'document', 'other');
create type "public"."order_status_v2" as enum ('CREATED', 'PAID', 'PREPARING_ORDER', 'WAITING_CUSTOMER_CONFIRMATION', 'READY_TO_SHIP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'ISSUE_REPORTED', 'DISPUTE', 'SELLER_TIMEOUT', 'CANCELLED', 'PICKED_UP', 'READY_FOR_PICKUP');
create type "public"."order_timeline_event_type" as enum ('ORDER_CREATED', 'ORDER_PAID', 'ORDER_PREPARING', 'ATTACHMENT_UPLOADED', 'CUSTOMER_CONFIRMED', 'CUSTOMER_REPORTED_ISSUE', 'DISPUTE_CREATED', 'SHIPPING_PAYMENT_PENDING', 'SHIPPING_PAYMENT_CONFIRMED', 'PICKUP_CODE_GENERATED', 'ORDER_READY_TO_SHIP', 'ORDER_IN_TRANSIT', 'ORDER_DELIVERED', 'ORDER_COMPLETED', 'SELLER_TIMEOUT', 'AUTO_APPROVED', 'ORDER_CANCELLED', 'ORDER_PICKED_UP', 'ORDER_READY_FOR_PICKUP');
create type "public"."payment_method" as enum ('card', 'yape', 'plin');
create type "public"."payment_status" as enum ('pending', 'paid', 'not_delivered', 'delivered', 'completed', 'failed', 'disputed', 'refund_requested', 'refunded', 'esperando_confirmacion', 'validando', 'en_reparto');
create type "public"."plan_payment_status" as enum ('pending', 'paid', 'failed', 'refunded', 'disputed');
create type "public"."shipping_type" as enum ('agencia', 'domicilio', 'recojo');
create type "public"."subscription_plan" as enum ('basico', 'emprendedor', 'business_pro', 'enterprise_ai', 'enterprise_pro', 'lite', 'lite_pago', 'lite_plus');
create type "public"."subscription_status" as enum ('active', 'inactive', 'past_due', 'canceled', 'expired', 'trialing');
create type "public"."theme_mode" as enum ('light', 'dark');

-- Sequences
create sequence if not exists "public"."seq_plan_payment_b001";

-- Tables
create table if not exists "public"."activity_log" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "actor_id" uuid,
  "actor_name" text,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" text,
  "description" text not null,
  "details" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."appeals" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "deactivation_notice_id" uuid not null,
  "seller_statement" text not null,
  "seller_evidence" jsonb default '{}'::jsonb,
  "submitted_at" timestamp with time zone default now() not null,
  "status" appeal_status default 'pending'::appeal_status not null,
  "admin_reviewer_id" uuid,
  "admin_notes" text,
  "reviewed_at" timestamp with time zone,
  "sla_deadline" timestamp with time zone not null,
  "sla_breached" boolean default false not null,
  "resolution" text,
  "reactivated_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."business_invitations" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "code" text not null,
  "code_hash" text not null,
  "max_uses" integer,
  "used_count" integer default 0 not null,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "created_by" uuid
);

create table if not exists "public"."business_settings" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "theme_mode" text default 'light'::text not null,
  "contrast_level" text default 'standard'::text not null,
  "custom_colors" jsonb default '{}'::jsonb,
  "preferences" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "culqi_public_key" text,
  "culqi_secret_key" text
);

create table if not exists "public"."business_slug_aliases" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "slug" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."business_subscriptions" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "plan_type" subscription_plan default 'basico'::subscription_plan not null,
  "plan_status" subscription_status default 'inactive'::subscription_status not null,
  "plan_start_date" timestamp with time zone,
  "plan_end_date" timestamp with time zone,
  "plan_updated_at" timestamp with time zone default now() not null,
  "gateway_subscription_id" text,
  "gateway_customer_id" text,
  "gateway_plan_id" text,
  "cancel_at_period_end" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."business_team_members" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "user_id" uuid not null,
  "role" text default 'member'::text not null,
  "joined_at" timestamp with time zone default now() not null,
  "invitation_id" uuid,
  "custom_permissions" jsonb
);

create table if not exists "public"."business_team_roles" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "role" text not null,
  "permissions" jsonb default '[]'::jsonb,
  "is_default" boolean default false,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."businesses" (
  "id" uuid default gen_random_uuid() not null,
  "owner_id" uuid not null,
  "name" text not null,
  "slug" text not null,
  "cover_image_url" text,
  "logo_url" text,
  "address" text,
  "store_type" text,
  "description" text,
  "whatsapp_number" text,
  "tax_id" text,
  "person_type" text,
  "country" text,
  "city" text,
  "email" text,
  "legal_rep_name" text,
  "legal_rep_role" text,
  "legal_rep_phone" text,
  "legal_rep_email" text,
  "payment_flow" text[],
  "latitude" numeric(10,7),
  "longitude" numeric(10,7),
  "geo_region" text,
  "geo_placename" text,
  "seo_title" text,
  "seo_description" text,
  "seo_keywords" text[],
  "is_active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "verification_status" text default 'unverified'::text not null,
  "verification_data" jsonb default '{}'::jsonb,
  "departamento" text,
  "provincia" text,
  "distrito" text,
  "hero_images" text[],
  "culqi_blocked" boolean default false not null,
  "penalty_debt" numeric(10,2) default '0'::numeric not null,
  "penalty_count" integer default 0 not null,
  "blacklisted" boolean default false not null,
  "blacklisted_at" timestamp with time zone,
  "social_links" jsonb default '{}'::jsonb,
  "deactivation_reason" deactivation_reason,
  "deactivation_date" timestamp with time zone,
  "appeal_status" appeal_status,
  "grace_period_ends_at" timestamp with time zone
);

create table if not exists "public"."chat_sessions" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "guest_id" text not null,
  "guest_name" text not null,
  "guest_gender" text default ''::text not null,
  "status" text default 'active'::text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "payment_id" uuid,
  "auth_user_id" uuid,
  "guest_email" text,
  "guest_avatar_url" text
);

create table if not exists "public"."complaint_book_records" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "ticket_number" text not null,
  "consumer_last_name" text not null,
  "consumer_first_name" text not null,
  "consumer_doc_type" text not null,
  "consumer_doc_id" text not null,
  "consumer_address" text not null,
  "consumer_phone" text not null,
  "consumer_email" text not null,
  "minor_age" boolean default false not null,
  "guardian_name" text,
  "claim_type" text default 'reclamo'::text not null,
  "contract_description" text not null,
  "claimed_amount" numeric(10,2),
  "claim_description" text not null,
  "consumer_request" text not null,
  "sla_deadline" timestamp with time zone not null,
  "status" text default 'pending'::text not null,
  "admin_response" text,
  "admin_responded_at" timestamp with time zone,
  "email_sent_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "score" integer default 0,
  "score_tier" complaint_score_tier default 'rejected'::complaint_score_tier,
  "score_breakdown" jsonb default '{}'::jsonb,
  "is_verified" boolean default false not null,
  "verified_at" timestamp with time zone,
  "linked_order_id" uuid
);

create table if not exists "public"."deactivation_notices" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "reason" deactivation_reason not null,
  "complaint_count" integer default 0,
  "incomplete_order_rate" integer,
  "evidence" jsonb default '{}'::jsonb,
  "notification_sent_at" timestamp with time zone,
  "notification_method" text,
  "notification_reference" text,
  "grace_period_ends_at" timestamp with time zone not null,
  "appeal_deadline" timestamp with time zone not null,
  "is_resolved" boolean default false not null,
  "resolved_at" timestamp with time zone,
  "resolved_by" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."deletion_feedback" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid,
  "owner_id" uuid not null,
  "business_name" text not null,
  "business_slug" text not null,
  "business_tax_id" text,
  "reason" text,
  "snapshot" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."feedback_responses" (
  "id" uuid default gen_random_uuid() not null,
  "ticket_id" uuid not null,
  "sender_type" feedback_sender_type not null,
  "message" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."feedback_tickets" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "user_id" uuid not null,
  "ticket_number" text not null,
  "category" feedback_category not null,
  "subject" text not null,
  "message" text not null,
  "status" feedback_status default 'open'::feedback_status not null,
  "priority" feedback_priority default 'normal'::feedback_priority not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "request_type" feedback_request_type default 'feedback'::feedback_request_type not null
);

create table if not exists "public"."form_messages" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "sender_name" text not null,
  "sender_email" text not null,
  "sender_phone" text,
  "message_text" text not null,
  "is_read" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."import_jobs" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "status" import_job_status default 'pending'::import_job_status not null,
  "total_rows" integer default 0 not null,
  "processed_rows" integer default 0 not null,
  "error_rows" integer default 0 not null,
  "file_name" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "completed_at" timestamp with time zone
);

create table if not exists "public"."import_rows" (
  "id" uuid default gen_random_uuid() not null,
  "job_id" uuid not null,
  "row_number" integer not null,
  "status" import_row_status default 'pending'::import_row_status not null,
  "raw_data" jsonb default '{}'::jsonb,
  "product_id" uuid,
  "error_message" text,
  "created_at" timestamp with time zone default now() not null,
  "processed_at" timestamp with time zone
);

create table if not exists "public"."messages" (
  "id" uuid default gen_random_uuid() not null,
  "session_id" uuid not null,
  "content" text not null,
  "is_from_store" boolean default false not null,
  "is_read" boolean default false not null,
  "created_at" timestamp with time zone default now(),
  "payment_id" uuid
);

create table if not exists "public"."notifications" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "type" notification_type not null,
  "category" notification_category not null,
  "title" text not null,
  "message" text not null,
  "data" jsonb default '{}'::jsonb,
  "is_read" boolean default false not null,
  "is_dismissed" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "read_at" timestamp with time zone
);

create table if not exists "public"."order_attachments" (
  "id" uuid default gen_random_uuid() not null,
  "order_id" uuid not null,
  "file_url" text not null,
  "file_name" text not null,
  "attachment_type" order_attachment_type not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."order_events" (
  "id" uuid default gen_random_uuid() not null,
  "payment_id" uuid not null,
  "from_status" text,
  "to_status" text not null,
  "triggered_by" text,
  "reason" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."order_timeline_events" (
  "id" uuid default gen_random_uuid() not null,
  "order_id" uuid not null,
  "event_type" order_timeline_event_type not null,
  "actor_type" text not null,
  "actor_id" uuid,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."payment_chats" (
  "id" uuid default gen_random_uuid() not null,
  "payment_id" uuid not null,
  "token" text not null,
  "sender" text not null,
  "message" text not null,
  "is_read" boolean default false,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."payment_idempotency_keys" (
  "key" text not null,
  "status" text default 'processing'::text not null,
  "response_status" integer,
  "response_body" jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."payment_orders" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "culqi_order_id" text not null,
  "amount" numeric(10,2) not null,
  "currency" text default 'PEN'::text not null,
  "status" text default 'pending'::text not null,
  "payment_method" text not null,
  "payment_code" text,
  "qr_url" text,
  "buyer_email" text not null,
  "buyer_phone" text,
  "expiration_date" timestamp with time zone not null,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."payments" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "product_id" uuid not null,
  "seller_user_id" uuid not null,
  "amount" numeric(10,2) not null,
  "currency" text default 'PEN'::text not null,
  "payment_method" text not null,
  "culqi_charge_id" text,
  "culqi_reference_code" text,
  "culqi_tracking_id" text,
  "buyer_email" text not null,
  "buyer_phone" text,
  "status" text default 'pending'::text not null,
  "delivery_code_hash" text,
  "delivery_code_expires_at" timestamp with time zone,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "order_number" text not null,
  "shipping_type" shipping_type,
  "shipping_department" text,
  "shipping_province" text,
  "shipping_district" text,
  "shipping_address" text,
  "shipping_agency" text,
  "shipping_reference" text,
  "shipping_phone" text,
  "shipping_cost" numeric(10,2),
  "ticket_url" text,
  "buyer_dni" text,
  "shipped_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "seller_status" text,
  "ticket_image_url" text,
  "rejection_reason" text,
  "rejection_image" text,
  "tracking_token" text not null,
  "finalization_requested_at" timestamp with time zone,
  "finalization_confirmed_at" timestamp with time zone,
  "finalization_deadline" timestamp with time zone,
  "version" integer default 0 not null,
  "courier_name" text,
  "tracking_number" text,
  "pickup_code" text,
  "seller_note" text,
  "shipping_paid_at" timestamp with time zone,
  "shipping_ubigeo" text,
  "culqi_order_id" text
);

create table if not exists "public"."penalties" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "order_id" uuid not null,
  "penalty_type" text not null,
  "title" text not null,
  "description" text not null,
  "amount" numeric(10,2) not null,
  "percentage" numeric(5,2),
  "product_value" numeric(10,2),
  "status" text default 'pending'::text not null,
  "paid_at" timestamp with time zone,
  "payment_method" text,
  "payment_id" text,
  "order_number" text,
  "created_at" timestamp with time zone default now() not null,
  "resolved_at" timestamp with time zone,
  "notes" text
);

create table if not exists "public"."plan_payments" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "plan_type" subscription_plan not null,
  "period" text default 'monthly'::text not null,
  "amount_subtotal" numeric(10,2) not null,
  "amount_igv" numeric(10,2) not null,
  "amount_total" numeric(10,2) not null,
  "currency" text default 'PEN'::text not null,
  "payment_method" payment_method not null,
  "culqi_charge_id" text,
  "culqi_reference_code" text,
  "status" plan_payment_status default 'pending'::plan_payment_status not null,
  "buyer_email" text not null,
  "buyer_full_name" text,
  "buyer_document_type" text,
  "buyer_document_number" text,
  "buyer_address" text,
  "ticket_series" text default 'B001'::text not null,
  "ticket_correlative" integer default nextval('seq_plan_payment_b001'::regclass) not null,
  "ticket_url" text,
  "ticket_issued_at" timestamp with time zone,
  "plan_start_date" timestamp with time zone,
  "plan_end_date" timestamp with time zone,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."product_categories" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "name" text not null,
  "slug" text not null,
  "image_url" text,
  "display_order" integer default 0,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."product_likes" (
  "id" uuid default gen_random_uuid() not null,
  "product_id" uuid not null,
  "ip_address" text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."product_media" (
  "id" uuid default gen_random_uuid() not null,
  "product_id" uuid not null,
  "media_url" text not null,
  "media_type" text default 'image'::text not null,
  "display_order" integer default 0 not null,
  "alt_text" text,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."products" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "category_id" uuid,
  "title" text not null,
  "description" text,
  "price" numeric(10,2) not null,
  "second_price" numeric(10,2),
  "stock" integer default 0 not null,
  "currency" text default 'PEN'::text not null,
  "is_available" boolean default true not null,
  "tags" text[],
  "stars" integer default 0,
  "sale_status" text default 'NORMAL'::text not null,
  "brand" text,
  "slug" text,
  "seo_title" text,
  "seo_description" text,
  "shipping_info" text,
  "display_order" integer default 0,
  "metadata" jsonb default '{}'::jsonb,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "external_code" text
);

create table if not exists "public"."profiles" (
  "id" uuid not null,
  "email" text not null,
  "full_name" text not null,
  "avatar_url" text,
  "provider_id" text,
  "age" integer,
  "address" text,
  "phone" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."saas_issuer_config" (
  "id" integer default 1 not null,
  "ruc" text not null,
  "razon_social" text not null,
  "direccion" text not null,
  "distrito" text not null,
  "provincia" text not null,
  "departamento" text not null,
  "ubigeo" text,
  "logo_url" text,
  "igv_rate" numeric(5,4) default 0.18 not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."seller_payout_accounts" (
  "id" uuid default gen_random_uuid() not null,
  "seller_user_id" uuid not null,
  "full_name" text not null,
  "document_type" text default 'DNI'::text not null,
  "document_number" text not null,
  "bank_name" text not null,
  "bank_account_number" text not null,
  "bank_cci" text,
  "country" text default 'PE'::text not null,
  "verified" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."stock_movements" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "source_type" text not null,
  "source_id" uuid not null,
  "items" jsonb default '[]'::jsonb not null,
  "outcome" text not null,
  "fallback_qty1" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."verification_otps" (
  "id" uuid default gen_random_uuid() not null,
  "identifier" text not null,
  "code_hash" text not null,
  "type" text not null,
  "expires_at" timestamp with time zone not null,
  "verified" boolean default false not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."whatsapp_channels" (
  "id" uuid default gen_random_uuid() not null,
  "business_id" uuid not null,
  "ycloud_phone_number_id" text not null,
  "waba_id" text,
  "display_phone_number" text,
  "is_active" boolean default false not null,
  "connected_at" timestamp with time zone,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now(),
  "connection_status" text default 'pending'::text not null
);

create table if not exists "public"."whatsapp_conversations" (
  "id" uuid default gen_random_uuid() not null,
  "channel_id" uuid not null,
  "customer_phone" text not null,
  "customer_name" text,
  "meta_bsu_id" text,
  "last_message_at" timestamp with time zone default now(),
  "status" text default 'active'::text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);

create table if not exists "public"."whatsapp_messages" (
  "id" uuid default gen_random_uuid() not null,
  "conversation_id" uuid not null,
  "channel_id" uuid not null,
  "direction" text not null,
  "type" text not null,
  "template_name" text,
  "body" text,
  "ycloud_message_id" text not null,
  "status" text default 'accepted'::text not null,
  "meta_price" text,
  "meta_currency" text,
  "error_code" text,
  "error_message" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);

create table if not exists "public"."whatsapp_templates" (
  "id" uuid default gen_random_uuid() not null,
  "channel_id" uuid,
  "name" text not null,
  "category" text not null,
  "language" text default 'es'::text not null,
  "body" text not null,
  "meta_status" text default 'pending'::text,
  "meta_template_id" text,
  "created_at" timestamp with time zone default now(),
  "updated_at" timestamp with time zone default now()
);

-- Primary keys, unique, check, exclusion
alter table public."activity_log" add constraint "activity_log_pkey" PRIMARY KEY (id);
alter table public."appeals" add constraint "appeals_pkey" PRIMARY KEY (id);
alter table public."business_invitations" add constraint "business_invitations_code_unique" UNIQUE (code);
alter table public."business_invitations" add constraint "business_invitations_pkey" PRIMARY KEY (id);
alter table public."business_settings" add constraint "business_settings_pkey" PRIMARY KEY (id);
alter table public."business_settings" add constraint "unique_business_settings" UNIQUE (business_id);
alter table public."business_slug_aliases" add constraint "business_slug_aliases_pkey" PRIMARY KEY (id);
alter table public."business_slug_aliases" add constraint "business_slug_aliases_slug_format_check" CHECK (((char_length(slug) >= 3) AND (char_length(slug) <= 50) AND (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)));
alter table public."business_slug_aliases" add constraint "business_slug_aliases_slug_unique" UNIQUE (slug);
alter table public."business_subscriptions" add constraint "business_subscriptions_gateway_subscription_id_unique" UNIQUE (gateway_subscription_id);
alter table public."business_subscriptions" add constraint "business_subscriptions_pkey" PRIMARY KEY (id);
alter table public."business_subscriptions" add constraint "chk_business_subscription_date_order" CHECK (((plan_end_date IS NULL) OR (plan_start_date IS NULL) OR (plan_end_date >= plan_start_date)));
alter table public."business_subscriptions" add constraint "unique_business_subscription" UNIQUE (business_id);
alter table public."business_team_members" add constraint "business_team_members_pkey" PRIMARY KEY (id);
alter table public."business_team_members" add constraint "unique_business_user" UNIQUE (business_id, user_id);
alter table public."business_team_roles" add constraint "business_team_roles_pkey" PRIMARY KEY (id);
alter table public."business_team_roles" add constraint "unique_business_role" UNIQUE (business_id, role);
alter table public."businesses" add constraint "businesses_pkey" PRIMARY KEY (id);
alter table public."businesses" add constraint "businesses_slug_unique" UNIQUE (slug);
alter table public."businesses" add constraint "businesses_verification_status_check" CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'pending'::text, 'verified'::text, 'rejected'::text])));
alter table public."businesses" add constraint "description_length_check" CHECK ((char_length(description) <= 1000));
alter table public."businesses" add constraint "name_length_check" CHECK (((char_length(name) >= 3) AND (char_length(name) <= 100)));
alter table public."businesses" add constraint "payment_flow_length_check" CHECK ((COALESCE(array_length(payment_flow, 1), 0) <= 5));
alter table public."businesses" add constraint "slug_format_check" CHECK (((char_length(slug) >= 3) AND (char_length(slug) <= 50) AND (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)));
alter table public."businesses" add constraint "whatsapp_format_check" CHECK ((whatsapp_number ~ '^\+?[1-9]\d{1,14}$'::text));
alter table public."chat_sessions" add constraint "chat_sessions_pkey" PRIMARY KEY (id);
alter table public."complaint_book_records" add constraint "complaint_book_records_pkey" PRIMARY KEY (id);
alter table public."complaint_book_records" add constraint "complaint_book_records_ticket_number_unique" UNIQUE (ticket_number);
alter table public."deactivation_notices" add constraint "deactivation_notices_pkey" PRIMARY KEY (id);
alter table public."deletion_feedback" add constraint "deletion_feedback_pkey" PRIMARY KEY (id);
alter table public."feedback_responses" add constraint "feedback_responses_pkey" PRIMARY KEY (id);
alter table public."feedback_tickets" add constraint "feedback_tickets_pkey" PRIMARY KEY (id);
alter table public."feedback_tickets" add constraint "feedback_tickets_ticket_number_key" UNIQUE (ticket_number);
alter table public."form_messages" add constraint "form_messages_pkey" PRIMARY KEY (id);
alter table public."form_messages" add constraint "message_text_check" CHECK (((char_length(message_text) >= 10) AND (char_length(message_text) <= 1000)));
alter table public."form_messages" add constraint "sender_email_check" CHECK ((sender_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'::text));
alter table public."form_messages" add constraint "sender_name_check" CHECK ((char_length(sender_name) >= 2));
alter table public."import_jobs" add constraint "import_jobs_pkey" PRIMARY KEY (id);
alter table public."import_rows" add constraint "import_rows_pkey" PRIMARY KEY (id);
alter table public."messages" add constraint "messages_pkey" PRIMARY KEY (id);
alter table public."notifications" add constraint "notifications_pkey" PRIMARY KEY (id);
alter table public."order_attachments" add constraint "order_attachments_pkey" PRIMARY KEY (id);
alter table public."order_events" add constraint "order_events_pkey" PRIMARY KEY (id);
alter table public."order_timeline_events" add constraint "order_timeline_events_pkey" PRIMARY KEY (id);
alter table public."payment_chats" add constraint "payment_chats_pkey" PRIMARY KEY (id);
alter table public."payment_idempotency_keys" add constraint "payment_idempotency_keys_pkey" PRIMARY KEY (key);
alter table public."payment_orders" add constraint "payment_orders_culqi_order_id_unique" UNIQUE (culqi_order_id);
alter table public."payment_orders" add constraint "payment_orders_pkey" PRIMARY KEY (id);
alter table public."payments" add constraint "payments_amount_positive" CHECK ((amount > (0)::numeric));
alter table public."payments" add constraint "payments_culqi_charge_id_unique" UNIQUE (culqi_charge_id);
alter table public."payments" add constraint "payments_pkey" PRIMARY KEY (id);
alter table public."penalties" add constraint "penalties_pkey" PRIMARY KEY (id);
alter table public."plan_payments" add constraint "plan_payments_culqi_charge_id_unique" UNIQUE (culqi_charge_id);
alter table public."plan_payments" add constraint "plan_payments_pkey" PRIMARY KEY (id);
alter table public."plan_payments" add constraint "unique_plan_payment_correlative" UNIQUE (ticket_series, ticket_correlative);
alter table public."product_categories" add constraint "category_name_check" CHECK (((char_length(name) >= 2) AND (char_length(name) <= 50)));
alter table public."product_categories" add constraint "product_categories_pkey" PRIMARY KEY (id);
alter table public."product_categories" add constraint "unique_business_category" UNIQUE (business_id, slug);
alter table public."product_likes" add constraint "product_likes_pkey" PRIMARY KEY (id);
alter table public."product_likes" add constraint "unique_product_like" UNIQUE (product_id, ip_address);
alter table public."product_media" add constraint "product_media_pkey" PRIMARY KEY (id);
alter table public."product_media" add constraint "unique_product_media_display_order" UNIQUE (product_id, display_order);
alter table public."products" add constraint "currency_check" CHECK ((char_length(currency) = 3));
alter table public."products" add constraint "description_length_check" CHECK ((char_length(description) <= 2000));
alter table public."products" add constraint "price_check" CHECK ((price >= (0)::numeric));
alter table public."products" add constraint "products_pkey" PRIMARY KEY (id);
alter table public."products" add constraint "products_stars_non_negative" CHECK ((stars >= 0));
alter table public."products" add constraint "stock_check" CHECK ((stock >= 0));
alter table public."products" add constraint "title_length_check" CHECK (((char_length(title) >= 3) AND (char_length(title) <= 200)));
alter table public."products" add constraint "unique_business_product_slug" UNIQUE (business_id, slug);
alter table public."profiles" add constraint "age_check" CHECK (((age >= 13) AND (age <= 120)));
alter table public."profiles" add constraint "profiles_email_unique" UNIQUE (email);
alter table public."profiles" add constraint "profiles_pkey" PRIMARY KEY (id);
alter table public."saas_issuer_config" add constraint "saas_issuer_config_pkey" PRIMARY KEY (id);
alter table public."saas_issuer_config" add constraint "saas_issuer_singleton" CHECK ((id = 1));
alter table public."seller_payout_accounts" add constraint "seller_payout_accounts_pkey" PRIMARY KEY (id);
alter table public."seller_payout_accounts" add constraint "seller_payout_accounts_seller_user_id_unique" UNIQUE (seller_user_id);
alter table public."stock_movements" add constraint "stock_movements_outcome_check" CHECK ((outcome = ANY (ARRAY['fulfilled'::text, 'partial'::text, 'no_product'::text])));
alter table public."stock_movements" add constraint "stock_movements_pkey" PRIMARY KEY (id);
alter table public."stock_movements" add constraint "stock_movements_source_type_check" CHECK ((source_type = ANY (ARRAY['payments'::text, 'payment_orders'::text])));
alter table public."stock_movements" add constraint "stock_movements_source_unique" UNIQUE (source_type, source_id);
alter table public."verification_otps" add constraint "verification_otps_pkey" PRIMARY KEY (id);
alter table public."verification_otps" add constraint "verification_otps_type_check" CHECK ((type = ANY (ARRAY['phone'::text, 'email'::text])));
alter table public."whatsapp_channels" add constraint "whatsapp_channels_pkey" PRIMARY KEY (id);
alter table public."whatsapp_channels" add constraint "whatsapp_channels_ycloud_phone_number_id_unique" UNIQUE (ycloud_phone_number_id);
alter table public."whatsapp_conversations" add constraint "whatsapp_conversations_pkey" PRIMARY KEY (id);
alter table public."whatsapp_messages" add constraint "whatsapp_messages_pkey" PRIMARY KEY (id);
alter table public."whatsapp_messages" add constraint "whatsapp_messages_ycloud_message_id_unique" UNIQUE (ycloud_message_id);
alter table public."whatsapp_templates" add constraint "whatsapp_templates_pkey" PRIMARY KEY (id);

-- Foreign keys
alter table public."appeals" add constraint "appeals_admin_reviewer_id_profiles_id_fk" FOREIGN KEY (admin_reviewer_id) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."appeals" add constraint "appeals_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."appeals" add constraint "appeals_deactivation_notice_id_deactivation_notices_id_fk" FOREIGN KEY (deactivation_notice_id) REFERENCES deactivation_notices(id) ON DELETE CASCADE;
alter table public."business_invitations" add constraint "business_invitations_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."business_invitations" add constraint "business_invitations_created_by_profiles_id_fk" FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
alter table public."business_settings" add constraint "business_settings_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."business_slug_aliases" add constraint "business_slug_aliases_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."business_subscriptions" add constraint "business_subscriptions_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."business_team_members" add constraint "business_team_members_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."business_team_members" add constraint "business_team_members_invitation_id_business_invitations_id_fk" FOREIGN KEY (invitation_id) REFERENCES business_invitations(id) ON DELETE SET NULL;
alter table public."business_team_members" add constraint "business_team_members_user_id_profiles_id_fk" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."business_team_roles" add constraint "business_team_roles_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."businesses" add constraint "businesses_owner_id_profiles_id_fk" FOREIGN KEY (owner_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."chat_sessions" add constraint "chat_sessions_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."chat_sessions" add constraint "chat_sessions_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public."complaint_book_records" add constraint "complaint_book_records_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."complaint_book_records" add constraint "complaint_book_records_linked_order_id_payments_id_fk" FOREIGN KEY (linked_order_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public."deactivation_notices" add constraint "deactivation_notices_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."feedback_responses" add constraint "feedback_responses_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES feedback_tickets(id) ON DELETE CASCADE;
alter table public."feedback_tickets" add constraint "feedback_tickets_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."feedback_tickets" add constraint "feedback_tickets_user_id_fkey" FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."form_messages" add constraint "form_messages_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."import_jobs" add constraint "import_jobs_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."import_rows" add constraint "import_rows_job_id_fkey" FOREIGN KEY (job_id) REFERENCES import_jobs(id) ON DELETE CASCADE;
alter table public."import_rows" add constraint "import_rows_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
alter table public."messages" add constraint "messages_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;
alter table public."messages" add constraint "messages_session_id_chat_sessions_id_fk" FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;
alter table public."notifications" add constraint "notifications_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."order_attachments" add constraint "order_attachments_order_id_payments_id_fk" FOREIGN KEY (order_id) REFERENCES payments(id) ON DELETE CASCADE;
alter table public."order_events" add constraint "order_events_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;
alter table public."order_timeline_events" add constraint "order_timeline_events_actor_id_profiles_id_fk" FOREIGN KEY (actor_id) REFERENCES profiles(id);
alter table public."order_timeline_events" add constraint "order_timeline_events_order_id_payments_id_fk" FOREIGN KEY (order_id) REFERENCES payments(id) ON DELETE CASCADE;
alter table public."payment_chats" add constraint "payment_chats_payment_id_fkey" FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE;
alter table public."payment_orders" add constraint "payment_orders_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;
alter table public."payments" add constraint "payments_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;
alter table public."payments" add constraint "payments_product_id_products_id_fk" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT;
alter table public."payments" add constraint "payments_seller_user_id_profiles_id_fk" FOREIGN KEY (seller_user_id) REFERENCES profiles(id) ON DELETE RESTRICT;
alter table public."penalties" add constraint "penalties_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE RESTRICT;
alter table public."penalties" add constraint "penalties_order_id_payments_id_fk" FOREIGN KEY (order_id) REFERENCES payments(id) ON DELETE RESTRICT;
alter table public."product_categories" add constraint "product_categories_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."product_likes" add constraint "product_likes_product_id_products_id_fk" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."product_media" add constraint "product_media_product_id_products_id_fk" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
alter table public."products" add constraint "products_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."products" add constraint "products_category_id_product_categories_id_fk" FOREIGN KEY (category_id) REFERENCES product_categories(id) ON DELETE SET NULL;
alter table public."seller_payout_accounts" add constraint "seller_payout_accounts_seller_user_id_profiles_id_fk" FOREIGN KEY (seller_user_id) REFERENCES profiles(id) ON DELETE CASCADE;
alter table public."stock_movements" add constraint "stock_movements_business_id_fkey" FOREIGN KEY (business_id) REFERENCES businesses(id);
alter table public."whatsapp_channels" add constraint "whatsapp_channels_business_id_businesses_id_fk" FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE;
alter table public."whatsapp_conversations" add constraint "whatsapp_conversations_channel_id_whatsapp_channels_id_fk" FOREIGN KEY (channel_id) REFERENCES whatsapp_channels(id) ON DELETE CASCADE;
alter table public."whatsapp_messages" add constraint "whatsapp_messages_channel_id_whatsapp_channels_id_fk" FOREIGN KEY (channel_id) REFERENCES whatsapp_channels(id) ON DELETE CASCADE;
alter table public."whatsapp_messages" add constraint "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY (conversation_id) REFERENCES whatsapp_conversations(id) ON DELETE CASCADE;
alter table public."whatsapp_templates" add constraint "whatsapp_templates_channel_id_whatsapp_channels_id_fk" FOREIGN KEY (channel_id) REFERENCES whatsapp_channels(id) ON DELETE CASCADE;

-- Indexes
CREATE INDEX idx_al_action ON public.activity_log USING btree (action);
CREATE INDEX idx_al_business_id ON public.activity_log USING btree (business_id);
CREATE INDEX idx_al_created_at ON public.activity_log USING btree (created_at DESC);
CREATE INDEX idx_appeals_business_id ON public.appeals USING btree (business_id);
CREATE INDEX idx_appeals_deactivation_notice_id ON public.appeals USING btree (deactivation_notice_id);
CREATE INDEX idx_appeals_sla_deadline ON public.appeals USING btree (sla_deadline);
CREATE INDEX idx_appeals_status ON public.appeals USING btree (status);
CREATE INDEX idx_appeals_submitted_at ON public.appeals USING btree (submitted_at DESC NULLS LAST);
CREATE INDEX idx_business_invitations_business_id ON public.business_invitations USING btree (business_id);
CREATE INDEX idx_business_invitations_code ON public.business_invitations USING btree (code);
CREATE INDEX idx_business_invitations_expires ON public.business_invitations USING btree (expires_at);
CREATE INDEX idx_business_settings_business_id ON public.business_settings USING btree (business_id);
CREATE INDEX idx_business_slug_aliases_business_id ON public.business_slug_aliases USING btree (business_id);
CREATE INDEX idx_business_slug_aliases_created_at ON public.business_slug_aliases USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_business_slug_aliases_slug ON public.business_slug_aliases USING btree (slug);
CREATE INDEX idx_business_subscriptions_business_id ON public.business_subscriptions USING btree (business_id);
CREATE INDEX idx_business_subscriptions_created_at ON public.business_subscriptions USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_business_subscriptions_gateway_sub_id ON public.business_subscriptions USING btree (gateway_subscription_id);
CREATE INDEX idx_business_team_members_business_id ON public.business_team_members USING btree (business_id);
CREATE INDEX idx_business_team_members_user_id ON public.business_team_members USING btree (user_id);
CREATE INDEX idx_business_team_roles_business_id ON public.business_team_roles USING btree (business_id);
CREATE INDEX idx_businesses_appeal_status ON public.businesses USING btree (appeal_status);
CREATE INDEX idx_businesses_created_at ON public.businesses USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_businesses_deactivation_reason ON public.businesses USING btree (deactivation_reason);
CREATE INDEX idx_businesses_grace_period_ends_at ON public.businesses USING btree (grace_period_ends_at);
CREATE INDEX idx_businesses_is_active ON public.businesses USING btree (is_active) WHERE (is_active = true);
CREATE INDEX idx_businesses_owner_id ON public.businesses USING btree (owner_id);
CREATE INDEX idx_businesses_slug ON public.businesses USING btree (slug);
CREATE INDEX idx_categories_business_id ON public.product_categories USING btree (business_id);
CREATE INDEX idx_categories_display_order ON public.product_categories USING btree (business_id, display_order);
CREATE INDEX idx_categories_slug ON public.product_categories USING btree (business_id, slug);
CREATE INDEX idx_cbr_active ON public.complaint_book_records USING btree (business_id, status) WHERE (deleted_at IS NULL);
CREATE INDEX idx_cbr_business_id ON public.complaint_book_records USING btree (business_id);
CREATE INDEX idx_cbr_created_at ON public.complaint_book_records USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_cbr_status ON public.complaint_book_records USING btree (business_id, status);
CREATE INDEX idx_cbr_ticket_number ON public.complaint_book_records USING btree (ticket_number);
CREATE INDEX idx_chat_sessions_auth_user_id ON public.chat_sessions USING btree (auth_user_id);
CREATE INDEX idx_chat_sessions_business_id ON public.chat_sessions USING btree (business_id);
CREATE INDEX idx_chat_sessions_business_status_created ON public.chat_sessions USING btree (business_id, status, created_at DESC);
CREATE INDEX idx_chat_sessions_guest_id ON public.chat_sessions USING btree (guest_id);
CREATE INDEX idx_chat_sessions_payment_id ON public.chat_sessions USING btree (payment_id);
CREATE INDEX idx_deactivation_notices_appeal_deadline ON public.deactivation_notices USING btree (appeal_deadline);
CREATE INDEX idx_deactivation_notices_business_id ON public.deactivation_notices USING btree (business_id);
CREATE INDEX idx_deactivation_notices_created_at ON public.deactivation_notices USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_deactivation_notices_grace_ends_at ON public.deactivation_notices USING btree (grace_period_ends_at);
CREATE INDEX idx_deactivation_notices_is_resolved ON public.deactivation_notices USING btree (is_resolved);
CREATE INDEX idx_deactivation_notices_reason ON public.deactivation_notices USING btree (reason);
CREATE INDEX idx_df_created_at ON public.deletion_feedback USING btree (created_at DESC);
CREATE INDEX idx_df_owner_id ON public.deletion_feedback USING btree (owner_id);
CREATE INDEX idx_form_messages_business_id ON public.form_messages USING btree (business_id);
CREATE INDEX idx_form_messages_created_at ON public.form_messages USING btree (business_id, created_at DESC NULLS LAST);
CREATE INDEX idx_form_messages_is_read ON public.form_messages USING btree (business_id, is_read) WHERE (is_read = false);
CREATE INDEX idx_fr_created_at ON public.feedback_responses USING btree (created_at);
CREATE INDEX idx_fr_ticket_id ON public.feedback_responses USING btree (ticket_id);
CREATE INDEX idx_ft_business_id ON public.feedback_tickets USING btree (business_id);
CREATE INDEX idx_ft_created_at ON public.feedback_tickets USING btree (created_at DESC);
CREATE INDEX idx_ft_request_type ON public.feedback_tickets USING btree (request_type);
CREATE INDEX idx_ft_status ON public.feedback_tickets USING btree (status);
CREATE INDEX idx_ft_ticket_number ON public.feedback_tickets USING btree (ticket_number);
CREATE INDEX idx_ft_user_id ON public.feedback_tickets USING btree (user_id);
CREATE INDEX idx_import_jobs_business_id ON public.import_jobs USING btree (business_id);
CREATE INDEX idx_import_jobs_status ON public.import_jobs USING btree (status);
CREATE INDEX idx_import_rows_job_id ON public.import_rows USING btree (job_id);
CREATE INDEX idx_import_rows_job_status ON public.import_rows USING btree (job_id, status);
CREATE INDEX idx_import_rows_status ON public.import_rows USING btree (status);
CREATE INDEX idx_messages_created_at ON public.messages USING btree (created_at);
CREATE INDEX idx_messages_payment_id ON public.messages USING btree (payment_id);
CREATE INDEX idx_messages_session_created ON public.messages USING btree (session_id, created_at);
CREATE INDEX idx_messages_session_id ON public.messages USING btree (session_id);
CREATE INDEX idx_notifications_business_created ON public.notifications USING btree (business_id, created_at DESC NULLS LAST);
CREATE INDEX idx_notifications_business_id ON public.notifications USING btree (business_id);
CREATE INDEX idx_notifications_category ON public.notifications USING btree (business_id, category);
CREATE INDEX idx_notifications_unread ON public.notifications USING btree (business_id, is_read) WHERE ((is_read = false) AND (is_dismissed = false));
CREATE INDEX idx_order_attachments_order_id ON public.order_attachments USING btree (order_id);
CREATE INDEX idx_order_events_created_at ON public.order_events USING btree (created_at DESC);
CREATE INDEX idx_order_events_payment_id ON public.order_events USING btree (payment_id);
CREATE INDEX idx_payment_chats_payment_id ON public.payment_chats USING btree (payment_id);
CREATE INDEX idx_payment_chats_token ON public.payment_chats USING btree (token);
CREATE INDEX idx_payment_idempotency_keys_created_at ON public.payment_idempotency_keys USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_payment_idempotency_keys_status ON public.payment_idempotency_keys USING btree (status);
CREATE INDEX idx_payment_orders_business_id ON public.payment_orders USING btree (business_id);
CREATE INDEX idx_payment_orders_culqi_order_id ON public.payment_orders USING btree (culqi_order_id);
CREATE INDEX idx_payment_orders_status ON public.payment_orders USING btree (status);
CREATE INDEX idx_payments_business_id ON public.payments USING btree (business_id);
CREATE INDEX idx_payments_buyer_dni ON public.payments USING btree (buyer_dni) WHERE (buyer_dni IS NOT NULL);
CREATE INDEX idx_payments_completed_at ON public.payments USING btree (completed_at DESC NULLS LAST);
CREATE INDEX idx_payments_created_at ON public.payments USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_payments_culqi_charge_id ON public.payments USING btree (culqi_charge_id);
CREATE INDEX idx_payments_finalization_deadline ON public.payments USING btree (finalization_deadline);
CREATE INDEX idx_payments_finalization_requested_at ON public.payments USING btree (finalization_requested_at DESC NULLS LAST);
CREATE INDEX idx_payments_product_id ON public.payments USING btree (product_id);
CREATE INDEX idx_payments_seller_status ON public.payments USING btree (seller_status);
CREATE INDEX idx_payments_seller_user_id ON public.payments USING btree (seller_user_id);
CREATE INDEX idx_payments_shipped_at ON public.payments USING btree (shipped_at DESC NULLS LAST);
CREATE INDEX idx_payments_status ON public.payments USING btree (status);
CREATE INDEX idx_payout_accounts_seller_user_id ON public.seller_payout_accounts USING btree (seller_user_id);
CREATE INDEX idx_penalties_business_id ON public.penalties USING btree (business_id);
CREATE INDEX idx_penalties_created_at ON public.penalties USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_penalties_order_id ON public.penalties USING btree (order_id);
CREATE INDEX idx_penalties_status ON public.penalties USING btree (business_id, status);
CREATE INDEX idx_product_likes_product_id ON public.product_likes USING btree (product_id);
CREATE INDEX idx_product_media_display_order ON public.product_media USING btree (product_id, display_order);
CREATE INDEX idx_product_media_product_id ON public.product_media USING btree (product_id);
CREATE INDEX idx_products_business_id ON public.products USING btree (business_id);
CREATE INDEX idx_products_business_updated ON public.products USING btree (business_id, updated_at DESC);
CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);
CREATE INDEX idx_products_created_at ON public.products USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_products_display_order ON public.products USING btree (business_id, display_order);
CREATE INDEX idx_products_is_available ON public.products USING btree (is_available) WHERE (is_available = true);
CREATE INDEX idx_products_slug ON public.products USING btree (business_id, slug);
CREATE INDEX idx_products_title_search ON public.products USING btree (title);
CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);
CREATE INDEX idx_profiles_full_name ON public.profiles USING btree (full_name);
CREATE INDEX idx_stock_movements_business_id ON public.stock_movements USING btree (business_id);
CREATE INDEX idx_stock_movements_created_at ON public.stock_movements USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_timeline_events_created_at ON public.order_timeline_events USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_timeline_events_order_id ON public.order_timeline_events USING btree (order_id);
CREATE INDEX idx_verification_otps_expires_at ON public.verification_otps USING btree (expires_at);
CREATE INDEX idx_verification_otps_identifier ON public.verification_otps USING btree (identifier);
CREATE INDEX idx_whatsapp_channels_created_at ON public.whatsapp_channels USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_channels_is_active ON public.whatsapp_channels USING btree (is_active);
CREATE INDEX idx_whatsapp_conversations_channel_id ON public.whatsapp_conversations USING btree (channel_id);
CREATE INDEX idx_whatsapp_conversations_created_at ON public.whatsapp_conversations USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_conversations_customer_phone ON public.whatsapp_conversations USING btree (customer_phone);
CREATE INDEX idx_whatsapp_conversations_last_message_at ON public.whatsapp_conversations USING btree (last_message_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_conversations_meta_bsu_id ON public.whatsapp_conversations USING btree (meta_bsu_id);
CREATE INDEX idx_whatsapp_conversations_status ON public.whatsapp_conversations USING btree (status);
CREATE INDEX idx_whatsapp_messages_channel_id ON public.whatsapp_messages USING btree (channel_id);
CREATE INDEX idx_whatsapp_messages_conversation_created ON public.whatsapp_messages USING btree (conversation_id, created_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_messages_conversation_id ON public.whatsapp_messages USING btree (conversation_id);
CREATE INDEX idx_whatsapp_messages_created_at ON public.whatsapp_messages USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_messages_status ON public.whatsapp_messages USING btree (status);
CREATE INDEX idx_whatsapp_templates_channel_id ON public.whatsapp_templates USING btree (channel_id);
CREATE INDEX idx_whatsapp_templates_created_at ON public.whatsapp_templates USING btree (created_at DESC NULLS LAST);
CREATE INDEX idx_whatsapp_templates_meta_status ON public.whatsapp_templates USING btree (meta_status);
CREATE INDEX idx_whatsapp_templates_name ON public.whatsapp_templates USING btree (name);
CREATE UNIQUE INDEX payments_culqi_order_id_unique ON public.payments USING btree (culqi_order_id);
CREATE UNIQUE INDEX payments_order_number_unique ON public.payments USING btree (order_number);
CREATE UNIQUE INDEX payments_tracking_token_unique ON public.payments USING btree (tracking_token);
CREATE UNIQUE INDEX uq_chat_sessions_active_per_guest ON public.chat_sessions USING btree (business_id, guest_id) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX uq_whatsapp_channels_business_id ON public.whatsapp_channels USING btree (business_id);
CREATE UNIQUE INDEX uq_whatsapp_channels_ycloud_phone_number_id ON public.whatsapp_channels USING btree (ycloud_phone_number_id);
CREATE UNIQUE INDEX uq_whatsapp_conversations_active_per_channel_meta_bsu ON public.whatsapp_conversations USING btree (channel_id, meta_bsu_id) WHERE (status = 'active'::text);
CREATE UNIQUE INDEX uq_whatsapp_messages_ycloud_message_id ON public.whatsapp_messages USING btree (ycloud_message_id);
CREATE UNIQUE INDEX uq_whatsapp_templates_channel_name ON public.whatsapp_templates USING btree (channel_id, name) WHERE (channel_id IS NOT NULL);
CREATE UNIQUE INDEX uq_whatsapp_templates_meta_template_id ON public.whatsapp_templates USING btree (meta_template_id);

-- Functions
CREATE OR REPLACE FUNCTION public.is_business_member(target_business_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.business_team_members
    WHERE business_id = target_business_id
      AND user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.businesses
    WHERE id = target_business_id
      AND owner_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.prevent_order_number_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
IF OLD.order_number IS DISTINCT FROM NEW.order_number THEN
RAISE EXCEPTION 'payments.order_number is immutable and cannot be changed' USING ERRCODE = 'restrict_violation';
END IF;
RETURN NEW;
END$function$;

-- Triggers
CREATE TRIGGER payments_order_number_immutable BEFORE UPDATE OF order_number ON public.payments FOR EACH ROW EXECUTE FUNCTION prevent_order_number_update();

-- Row level security
alter table "public"."businesses" enable row level security;
alter table "public"."chat_sessions" enable row level security;
alter table "public"."complaint_book_records" enable row level security;
alter table "public"."deletion_feedback" enable row level security;
alter table "public"."feedback_responses" enable row level security;
alter table "public"."feedback_tickets" enable row level security;
alter table "public"."import_jobs" enable row level security;
alter table "public"."import_rows" enable row level security;
alter table "public"."messages" enable row level security;
alter table "public"."order_events" enable row level security;
alter table "public"."payment_chats" enable row level security;
alter table "public"."payment_idempotency_keys" enable row level security;
alter table "public"."payment_orders" enable row level security;
alter table "public"."payments" enable row level security;
alter table "public"."profiles" enable row level security;
alter table "public"."stock_movements" enable row level security;
alter table "public"."verification_otps" enable row level security;

-- Policies
create policy "businesses_select_member" on "public"."businesses" as PERMISSIVE for select to public using (is_business_member(id));
create policy "chat_sessions_select_member" on "public"."chat_sessions" as PERMISSIVE for select to public using (is_business_member(business_id));
create policy "feedback_responses_select_own" on "public"."feedback_responses" as PERMISSIVE for select to "authenticated" using ((EXISTS ( SELECT 1
   FROM feedback_tickets
  WHERE ((feedback_tickets.id = feedback_responses.ticket_id) AND (feedback_tickets.user_id = auth.uid())))));
create policy "feedback_tickets_insert_own" on "public"."feedback_tickets" as PERMISSIVE for insert to "authenticated" with check ((auth.uid() = user_id));
create policy "feedback_tickets_select_own" on "public"."feedback_tickets" as PERMISSIVE for select to "authenticated" using ((auth.uid() = user_id));
create policy "messages_select_member" on "public"."messages" as PERMISSIVE for select to public using (is_business_member(( SELECT cs.business_id
   FROM chat_sessions cs
  WHERE (cs.id = messages.session_id))));
create policy "payment_orders_select_member" on "public"."payment_orders" as PERMISSIVE for select to public using (is_business_member(business_id));
create policy "payments_select_member" on "public"."payments" as PERMISSIVE for select to public using (is_business_member(business_id));
create policy "Users can insert own profile" on "public"."profiles" as PERMISSIVE for insert to "authenticated" with check ((auth.uid() = id));
create policy "Users can update own profile" on "public"."profiles" as PERMISSIVE for update to "authenticated" using ((auth.uid() = id)) with check ((auth.uid() = id));
create policy "Users can view own profile" on "public"."profiles" as PERMISSIVE for select to "authenticated" using ((auth.uid() = id));

