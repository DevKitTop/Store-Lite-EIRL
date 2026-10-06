CREATE TABLE "whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"ycloud_phone_number_id" text NOT NULL,
	"waba_id" text,
	"display_phone_number" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "whatsapp_channels_ycloud_phone_number_id_unique" UNIQUE("ycloud_phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_name" text,
	"meta_bsu_id" text,
	"last_message_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'active',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"type" text NOT NULL,
	"template_name" text,
	"body" text,
	"ycloud_message_id" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"meta_price" text,
	"meta_currency" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "whatsapp_messages_ycloud_message_id_unique" UNIQUE("ycloud_message_id")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"body" text NOT NULL,
	"meta_status" text DEFAULT 'pending',
	"meta_template_id" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_channels_business_id" ON "whatsapp_channels" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_channels_ycloud_phone_number_id" ON "whatsapp_channels" USING btree ("ycloud_phone_number_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_channels_is_active" ON "whatsapp_channels" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_channels_created_at" ON "whatsapp_channels" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_channel_id" ON "whatsapp_conversations" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_customer_phone" ON "whatsapp_conversations" USING btree ("customer_phone");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_meta_bsu_id" ON "whatsapp_conversations" USING btree ("meta_bsu_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_status" ON "whatsapp_conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_last_message_at" ON "whatsapp_conversations" USING btree ("last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_conversations_active_per_channel_meta_bsu" ON "whatsapp_conversations" USING btree ("channel_id","meta_bsu_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_whatsapp_conversations_created_at" ON "whatsapp_conversations" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_conversation_id" ON "whatsapp_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_channel_id" ON "whatsapp_messages" USING btree ("channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_messages_ycloud_message_id" ON "whatsapp_messages" USING btree ("ycloud_message_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_status" ON "whatsapp_messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_created_at" ON "whatsapp_messages" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_whatsapp_messages_conversation_created" ON "whatsapp_messages" USING btree ("conversation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_channel_id" ON "whatsapp_templates" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_name" ON "whatsapp_templates" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_meta_status" ON "whatsapp_templates" USING btree ("meta_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_templates_meta_template_id" ON "whatsapp_templates" USING btree ("meta_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_whatsapp_templates_channel_name" ON "whatsapp_templates" USING btree ("channel_id","name") WHERE channel_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_whatsapp_templates_created_at" ON "whatsapp_templates" USING btree ("created_at" DESC NULLS LAST);