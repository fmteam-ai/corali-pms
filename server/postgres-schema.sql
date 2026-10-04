-- Generated from drizzle/meta/0014_snapshot.json.
-- Hotel Corali PMS PostgreSQL schema.

CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "automation_key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "message_body" TEXT NOT NULL,
  "scheduled_for" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "automation_settings" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "checkin_days_before" BIGINT NOT NULL DEFAULT 5,
  "poststay_days_after" BIGINT NOT NULL DEFAULT 2,
  "channels" TEXT NOT NULL DEFAULT 'email',
  "checkin_template" TEXT NOT NULL,
  "review_template" TEXT NOT NULL,
  "templates_json" TEXT NOT NULL DEFAULT '{}',
  "review_url" TEXT NOT NULL DEFAULT '',
  "active" BIGINT NOT NULL DEFAULT 1,
  "updated_at" BIGINT NOT NULL
);

ALTER TABLE "automation_settings" ADD COLUMN IF NOT EXISTS "templates_json" TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS "balance_reminder_runs" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "balance_cents" BIGINT NOT NULL,
  "payment_link" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "scheduled_for" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "booking_recovery_runs" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "session_id" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "message_body" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "booking_sessions" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "guest_first_name" TEXT NOT NULL,
  "guest_last_name" TEXT NOT NULL,
  "guest_email" TEXT NOT NULL,
  "guest_phone" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "check_in" TEXT NOT NULL,
  "check_out" TEXT NOT NULL,
  "guests" BIGINT NOT NULL DEFAULT 1,
  "children" BIGINT NOT NULL DEFAULT 0,
  "child_ages" TEXT NOT NULL DEFAULT '[]',
  "rooms_count" BIGINT NOT NULL DEFAULT 1,
  "room_allocations" TEXT NOT NULL DEFAULT '[]',
  "room_key" TEXT NOT NULL,
  "rate_policy" TEXT NOT NULL DEFAULT 'flexible',
  "payment_gateway" TEXT NOT NULL DEFAULT 'stripe',
  "arrival_time" TEXT NOT NULL DEFAULT '',
  "travel_details" TEXT NOT NULL DEFAULT '',
  "special_requests" TEXT NOT NULL DEFAULT '',
  "luggage_assistance" BIGINT NOT NULL DEFAULT 0,
  "access_acknowledged" BIGINT NOT NULL DEFAULT 0,
  "policy_version" TEXT NOT NULL DEFAULT '2026-09-21',
  "policy_accepted_at" BIGINT,
  "selected_extra_ids" TEXT NOT NULL DEFAULT '[]',
  "room_subtotal_cents" BIGINT NOT NULL,
  "extras_cents" BIGINT NOT NULL DEFAULT 0,
  "charges_cents" BIGINT NOT NULL DEFAULT 0,
  "charge_breakdown" TEXT NOT NULL DEFAULT '[]',
  "total_cents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'started',
  "recovery_due_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);
ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "payable_cents" BIGINT;

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "guest_name" TEXT NOT NULL,
  "guest_email" TEXT,
  "guest_language" TEXT NOT NULL DEFAULT 'en',
  "room_id" BIGINT,
  "check_in" TEXT NOT NULL,
  "check_out" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'direct',
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "total_cents" BIGINT NOT NULL DEFAULT 0,
  "balance_cents" BIGINT NOT NULL DEFAULT 0,
  "rate_policy" TEXT NOT NULL DEFAULT 'flexible',
  "cancellation_days" BIGINT NOT NULL DEFAULT 7,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "booking_messages" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "sender" TEXT NOT NULL DEFAULT 'guest',
  "body" TEXT NOT NULL,
  "read_at" BIGINT,
  "email_notified" BIGINT NOT NULL DEFAULT 0,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_booking_messages_booking_created" ON "booking_messages" ("booking_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_booking_messages_owner_unread" ON "booking_messages" ("owner_id", "read_at");

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "language" TEXT NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS "integration_settings" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "whatsapp_provider" TEXT NOT NULL DEFAULT 'meta_cloud',
  "whatsapp_phone_number_id" TEXT NOT NULL DEFAULT '',
  "whatsapp_business_account_id" TEXT NOT NULL DEFAULT '',
  "whatsapp_connected" BIGINT NOT NULL DEFAULT 0,
  "email_client" TEXT NOT NULL DEFAULT 'internal',
  "external_email_address" TEXT NOT NULL DEFAULT '',
  "smtp_host" TEXT NOT NULL DEFAULT '',
  "smtp_port" BIGINT NOT NULL DEFAULT 587,
  "smtp_username" TEXT NOT NULL DEFAULT '',
  "email_connected" BIGINT NOT NULL DEFAULT 0,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "provider_connections" (
  "owner_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "active" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'configured',
  "settings_json" TEXT NOT NULL DEFAULT '{}',
  "secrets_encrypted" TEXT NOT NULL,
  "last_test_at" BIGINT,
  "last_test_result" TEXT,
  "updated_by" TEXT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  PRIMARY KEY ("owner_id", "provider_key")
);

CREATE TABLE IF NOT EXISTS "provider_connection_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "channel_connections" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "provider_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "connection_type" TEXT NOT NULL DEFAULT 'ota',
  "status" TEXT NOT NULL DEFAULT 'planned',
  "capabilities" TEXT NOT NULL DEFAULT '["reservations","rates","availability"]',
  "active" BIGINT NOT NULL DEFAULT 0,
  "connection_method" TEXT NOT NULL DEFAULT 'channel_manager',
  "property_code" TEXT NOT NULL DEFAULT '',
  "provider_endpoint" TEXT NOT NULL DEFAULT '',
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

ALTER TABLE "channel_connections" ADD COLUMN IF NOT EXISTS "connection_method" TEXT NOT NULL DEFAULT 'channel_manager';
ALTER TABLE "channel_connections" ADD COLUMN IF NOT EXISTS "property_code" TEXT NOT NULL DEFAULT '';
ALTER TABLE "channel_connections" ADD COLUMN IF NOT EXISTS "provider_endpoint" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "pricing_seasons" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "double_rate_cents" BIGINT NOT NULL,
  "apartment_rate_cents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "cancellation_policies" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "start_date" TEXT NOT NULL,
  "end_date" TEXT NOT NULL,
  "free_cancellation_days" BIGINT NOT NULL DEFAULT 7,
  "updated_at" BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_pricing_seasons_owner_dates" ON "pricing_seasons" ("owner_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "idx_cancellation_policies_owner_dates" ON "cancellation_policies" ("owner_id", "start_date", "end_date");

CREATE TABLE IF NOT EXISTS "rate_plans" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "adjustment_percent" BIGINT NOT NULL DEFAULT 0,
  "payment_policy" TEXT NOT NULL DEFAULT 'flexible',
  "active" BIGINT NOT NULL DEFAULT 1,
  "updated_at" BIGINT NOT NULL DEFAULT 0
);

-- Upgrade rate_plans created by earlier releases without losing its rows.
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "plan_key" TEXT;
ALTER TABLE "rate_plans" ADD COLUMN IF NOT EXISTS "updated_at" BIGINT NOT NULL DEFAULT 0;
UPDATE "rate_plans"
SET "plan_key" = CASE
  WHEN LOWER(COALESCE("name", '')) LIKE '%non%' THEN 'non_refundable'
  WHEN LOWER(COALESCE("name", '')) LIKE '%direct%' THEN 'direct_web'
  WHEN LOWER(COALESCE("name", '')) LIKE '%flex%' THEN 'flexible'
  ELSE 'legacy_' || "id"::TEXT
END
WHERE "plan_key" IS NULL OR "plan_key" = '';
ALTER TABLE "rate_plans" ALTER COLUMN "plan_key" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rate_plans_owner_key" ON "rate_plans" ("owner_id", "plan_key");

CREATE TABLE IF NOT EXISTS "coupons" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "discount_type" TEXT NOT NULL DEFAULT 'percentage',
  "discount_value" BIGINT NOT NULL,
  "applies_to" TEXT NOT NULL DEFAULT 'room_only',
  "valid_from" TEXT NOT NULL,
  "valid_to" TEXT NOT NULL,
  "max_uses" BIGINT,
  "usage_count" BIGINT NOT NULL DEFAULT 0,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL
);
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "combinable" BIGINT NOT NULL DEFAULT 1;
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'general';

CREATE TABLE IF NOT EXISTS "extras" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "price_cents" BIGINT NOT NULL,
  "pricing_mode" TEXT NOT NULL DEFAULT 'per_stay',
  "active" BIGINT NOT NULL DEFAULT 1,
  "sort_order" BIGINT NOT NULL DEFAULT 0,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "guest_checkins" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "booking_reference" TEXT,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "arrival_time" TEXT NOT NULL,
  "document_number" TEXT NOT NULL,
  "travel_details" TEXT NOT NULL DEFAULT '',
  "special_requests" TEXT NOT NULL DEFAULT '',
  "luggage_assistance" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "submitted_at" BIGINT NOT NULL
);
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "owner_id" TEXT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "booking_id" BIGINT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "document_type" TEXT NOT NULL DEFAULT 'passport';
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "date_of_birth_encrypted" TEXT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "birth_month" BIGINT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "birth_day" BIGINT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "adult_at_submission" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "preferred_language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "email_marketing_consent" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "whatsapp_marketing_consent" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "marketing_consent_at" BIGINT;
ALTER TABLE "guest_checkins" ADD COLUMN IF NOT EXISTS "marketing_consent_version" TEXT;

CREATE TABLE IF NOT EXISTS "checkin_access_tokens" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" BIGINT NOT NULL,
  "used_at" BIGINT,
  "created_by" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_checkin_tokens_booking" ON "checkin_access_tokens" ("owner_id", "booking_id", "status");

CREATE TABLE IF NOT EXISTS "booking_manage_tokens" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" BIGINT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_manage_tokens_booking" ON "booking_manage_tokens" ("owner_id", "booking_id", "status");

CREATE TABLE IF NOT EXISTS "public_request_limits" (
  "key_hash" TEXT PRIMARY KEY,
  "attempts" BIGINT NOT NULL DEFAULT 0,
  "window_started_at" BIGINT NOT NULL,
  "blocked_until" BIGINT,
  "updated_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_public_request_limits_updated" ON "public_request_limits" ("updated_at");

CREATE TABLE IF NOT EXISTS "guest_messages" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sent_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "housekeeping_tasks" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "room_id" BIGINT NOT NULL,
  "task_type" TEXT NOT NULL DEFAULT 'cleaning',
  "status" TEXT NOT NULL DEFAULT 'todo',
  "assigned_to" TEXT,
  "notes" TEXT,
  "due_at" BIGINT,
  "completed_at" BIGINT
);
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "checklist_json" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "cleaned_by_staff_id" BIGINT;
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "inspection_status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "inspected_by_staff_id" BIGINT;
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "inspected_at" BIGINT;
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "inspection_notes" TEXT;

CREATE TABLE IF NOT EXISTS "housekeeping_staff_room_defaults" (
  "owner_id" TEXT NOT NULL,
  "staff_user_id" BIGINT NOT NULL,
  "room_id" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL,
  PRIMARY KEY ("owner_id", "staff_user_id", "room_id")
);
CREATE INDEX IF NOT EXISTS "idx_housekeeping_defaults_room" ON "housekeeping_staff_room_defaults" ("owner_id", "room_id");

CREATE TABLE IF NOT EXISTS "birthday_message_runs" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "guest_checkin_id" BIGINT NOT NULL,
  "recipient_key" TEXT NOT NULL,
  "birthday_year" BIGINT NOT NULL,
  "coupon_id" BIGINT,
  "email_status" TEXT NOT NULL DEFAULT 'skipped',
  "whatsapp_status" TEXT NOT NULL DEFAULT 'skipped',
  "created_at" BIGINT NOT NULL,
  UNIQUE ("owner_id", "recipient_key", "birthday_year")
);
ALTER TABLE "birthday_message_runs" ADD COLUMN IF NOT EXISTS "recipient_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_birthday_run_recipient_year" ON "birthday_message_runs" ("owner_id", "recipient_key", "birthday_year") WHERE "recipient_key" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "mandatory_charges" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'extra_charge',
  "amount_cents" BIGINT NOT NULL,
  "calculation_mode" TEXT NOT NULL DEFAULT 'per_booking',
  "valid_from" TEXT,
  "valid_to" TEXT,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "payment_policies" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "full_payment" BIGINT NOT NULL DEFAULT 0,
  "deposit_percent" BIGINT NOT NULL DEFAULT 30,
  "balance_due_days" BIGINT NOT NULL DEFAULT 5,
  "full_payment_days_before_arrival" BIGINT NOT NULL DEFAULT 7,
  "full_payment_window_active" BIGINT NOT NULL DEFAULT 1,
  "reminder_channels" TEXT NOT NULL DEFAULT 'email',
  "active" BIGINT NOT NULL DEFAULT 1,
  "updated_at" BIGINT NOT NULL
);

ALTER TABLE "payment_policies"
  ADD COLUMN IF NOT EXISTS "full_payment_days_before_arrival" BIGINT NOT NULL DEFAULT 7;
ALTER TABLE "payment_policies" ADD COLUMN IF NOT EXISTS "full_payment_window_active" BIGINT NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS "payment_transactions" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_reference" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'payment',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "amount_cents" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "quotes" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "guest_name" TEXT NOT NULL,
  "guest_email" TEXT NOT NULL,
  "room_type" TEXT NOT NULL,
  "check_in" TEXT NOT NULL,
  "check_out" TEXT NOT NULL,
  "total_cents" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'held',
  "expires_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "rate_rules" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "rate_plan_id" BIGINT,
  "room_type" TEXT,
  "starts_on" TEXT NOT NULL,
  "ends_on" TEXT NOT NULL,
  "price_cents" BIGINT,
  "minimum_stay" BIGINT,
  "maximum_stay" BIGINT,
  "cancellation_days" BIGINT NOT NULL DEFAULT 7,
  "cancellation_penalty_percent" BIGINT NOT NULL DEFAULT 100,
  "modification_allowed" BIGINT NOT NULL DEFAULT 1,
  "closed_to_arrival" BIGINT NOT NULL DEFAULT 0,
  "closed_to_departure" BIGINT NOT NULL DEFAULT 0,
  "closed" BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS "rate_widget_settings" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "active" BIGINT NOT NULL DEFAULT 1,
  "position" TEXT NOT NULL DEFAULT 'right',
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "reminder_workflows" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "trigger_offset_minutes" BIGINT NOT NULL,
  "channels" TEXT NOT NULL DEFAULT 'email',
  "fallback_language" TEXT NOT NULL DEFAULT 'en',
  "template_key" TEXT NOT NULL,
  "active" BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "revenue_settings" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "member_discount_percent" BIGINT NOT NULL DEFAULT 5,
  "member_rates_active" BIGINT NOT NULL DEFAULT 0,
  "google_hotel_status" TEXT NOT NULL DEFAULT 'not_connected',
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "rooms" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "room_type" TEXT NOT NULL,
  "capacity" BIGINT NOT NULL DEFAULT 2,
  "active" BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS "room_categories" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name_el" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "description_el" TEXT NOT NULL DEFAULT '',
  "description_en" TEXT NOT NULL DEFAULT '',
  "display_order" BIGINT NOT NULL DEFAULT 0,
  "show_in_booking" BIGINT NOT NULL DEFAULT 1,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "room_amenities" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name_el" TEXT NOT NULL,
  "name_en" TEXT NOT NULL,
  "description_el" TEXT NOT NULL DEFAULT '',
  "description_en" TEXT NOT NULL DEFAULT '',
  "icon" TEXT NOT NULL DEFAULT 'sparkles',
  "amenity_group" TEXT NOT NULL DEFAULT 'comfort',
  "display_order" BIGINT NOT NULL DEFAULT 0,
  "show_on_card" BIGINT NOT NULL DEFAULT 0,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "room_amenity_assignments" (
  "room_id" BIGINT NOT NULL,
  "amenity_id" BIGINT NOT NULL,
  PRIMARY KEY ("room_id", "amenity_id")
);

CREATE TABLE IF NOT EXISTS "special_prices" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "starts_on" TEXT NOT NULL,
  "ends_on" TEXT NOT NULL,
  "adjustment_type" TEXT NOT NULL DEFAULT 'percentage',
  "adjustment_value" BIGINT NOT NULL DEFAULT 0,
  "operation" TEXT NOT NULL DEFAULT 'charge',
  "weekdays" TEXT NOT NULL DEFAULT '[]',
  "room_codes" TEXT NOT NULL DEFAULT '[]',
  "rate_plan_keys" TEXT NOT NULL DEFAULT '[]',
  "minimum_stay" BIGINT NOT NULL DEFAULT 1,
  "tied_to_year" BIGINT NOT NULL DEFAULT 1,
  "promotion" BIGINT NOT NULL DEFAULT 0,
  "priority" BIGINT NOT NULL DEFAULT 0,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "booking_restrictions" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "starts_on" TEXT NOT NULL,
  "ends_on" TEXT NOT NULL,
  "minimum_stay" BIGINT NOT NULL DEFAULT 1,
  "maximum_stay" BIGINT,
  "closed_arrival_weekdays" TEXT NOT NULL DEFAULT '[]',
  "closed_departure_weekdays" TEXT NOT NULL DEFAULT '[]',
  "room_codes" TEXT NOT NULL DEFAULT '[]',
  "rate_plan_keys" TEXT NOT NULL DEFAULT '[]',
  "priority" BIGINT NOT NULL DEFAULT 0,
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "pms_sessions" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL,
  "last_seen_at" BIGINT NOT NULL,
  "revoked_at" BIGINT,
  "user_agent" TEXT NOT NULL DEFAULT '',
  "ip_hash" TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS "pms_staff_users" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "totp_secret" TEXT NOT NULL,
  "permissions_json" TEXT NOT NULL DEFAULT '{}',
  "active" BIGINT NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  UNIQUE ("owner_id", "username")
);
ALTER TABLE "pms_staff_users" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'readonly';
ALTER TABLE "pms_staff_users" ADD COLUMN IF NOT EXISTS "totp_confirmed_at" BIGINT;
ALTER TABLE "pms_staff_users" ADD COLUMN IF NOT EXISTS "recovery_codes_json" TEXT NOT NULL DEFAULT '[]';
DO $$ BEGIN
  ALTER TABLE "pms_staff_users" ADD CONSTRAINT "pms_staff_users_role_check"
    CHECK ("role" IN ('owner', 'admin', 'reception', 'housekeeping', 'readonly')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
ALTER TABLE "pms_sessions" ADD COLUMN IF NOT EXISTS "staff_user_id" BIGINT;
CREATE INDEX IF NOT EXISTS "idx_staff_sessions" ON "pms_sessions" ("owner_id", "staff_user_id");

CREATE TABLE IF NOT EXISTS "pms_login_attempts" (
  "key_hash" TEXT PRIMARY KEY NOT NULL,
  "attempts" BIGINT NOT NULL DEFAULT 0,
  "window_started_at" BIGINT NOT NULL,
  "blocked_until" BIGINT,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "pms_profiles" (
  "owner_id" TEXT PRIMARY KEY NOT NULL,
  "display_name" TEXT NOT NULL DEFAULT 'Hotel Corali',
  "email" TEXT NOT NULL DEFAULT 'admin@hotelcorali.gr',
  "phone" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT 'administrator',
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "pms_dashboard_notes" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT 'yellow',
  "created_at" BIGINT NOT NULL,
  "updated_at" BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS "pms_notification_reads" (
  "owner_id" TEXT NOT NULL,
  "notification_key" TEXT NOT NULL,
  "read_at" BIGINT NOT NULL,
  PRIMARY KEY ("owner_id", "notification_key")
);

ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "base_rate_cents" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "amenities" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "images" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "category_id" BIGINT;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "operational_status" TEXT NOT NULL DEFAULT 'available';
CREATE TABLE IF NOT EXISTS "reservation_audit" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "before_json" TEXT NOT NULL,
  "after_json" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_reservation_audit_booking" ON "reservation_audit" ("owner_id", "booking_id", "created_at");
CREATE TABLE IF NOT EXISTS "folio_entries" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "entry_type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "payer" TEXT NOT NULL DEFAULT 'guest',
  "actor_id" TEXT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_folio_booking" ON "folio_entries" ("owner_id", "booking_id", "created_at");
ALTER TABLE "folio_entries" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "folio_entries" ADD COLUMN IF NOT EXISTS "receipt_reference" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_folio_payment_reference" ON "folio_entries" ("owner_id", "booking_id", "receipt_reference") WHERE "entry_type" = 'payment' AND "receipt_reference" IS NOT NULL;
ALTER TABLE "housekeeping_tasks" ADD COLUMN IF NOT EXISTS "photo_data" TEXT;
CREATE TABLE IF NOT EXISTS "guest_preferences" (
  "owner_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "preferences" TEXT NOT NULL DEFAULT '',
  "updated_by" TEXT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  PRIMARY KEY ("owner_id", "email")
);
CREATE TABLE IF NOT EXISTS "balance_payment_links" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "booking_id" BIGINT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expires_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_balance_links_booking" ON "balance_payment_links" ("owner_id", "booking_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_provider_reference" ON "payment_transactions" ("provider", "provider_reference") WHERE "provider_reference" IS NOT NULL;

ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "coupon_code" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_runs_booking_key" ON "automation_runs" ("booking_id", "automation_key");
CREATE INDEX IF NOT EXISTS "idx_automation_runs_owner_status" ON "automation_runs" ("owner_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_automation_settings_owner" ON "automation_settings" ("owner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_balance_reminders_booking" ON "balance_reminder_runs" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_balance_reminders_owner_status" ON "balance_reminder_runs" ("owner_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_recovery_session" ON "booking_recovery_runs" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_booking_recovery_owner_status" ON "booking_recovery_runs" ("owner_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_sessions_token" ON "booking_sessions" ("token");
CREATE INDEX IF NOT EXISTS "idx_booking_sessions_owner_status_due" ON "booking_sessions" ("owner_id", "status", "recovery_due_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bookings_owner_reference" ON "bookings" ("owner_id", "reference");
CREATE INDEX IF NOT EXISTS "idx_bookings_owner_checkin" ON "bookings" ("owner_id", "check_in");
CREATE INDEX IF NOT EXISTS "idx_bookings_owner_status" ON "bookings" ("owner_id", "status");
CREATE INDEX IF NOT EXISTS "idx_bookings_owner_room_dates" ON "bookings" ("owner_id", "room_id", "check_in", "check_out") WHERE "status" != 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_channel_connections_owner_provider" ON "channel_connections" ("owner_id", "provider_key");
CREATE INDEX IF NOT EXISTS "idx_channel_connections_owner_status" ON "channel_connections" ("owner_id", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_coupons_owner_code" ON "coupons" ("owner_id", "code");
CREATE INDEX IF NOT EXISTS "idx_coupons_owner_active" ON "coupons" ("owner_id", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_extras_owner_code" ON "extras" ("owner_id", "code");
CREATE INDEX IF NOT EXISTS "idx_extras_owner_active" ON "extras" ("owner_id", "active");
CREATE INDEX IF NOT EXISTS "idx_guest_checkins_reference" ON "guest_checkins" ("booking_reference");
CREATE INDEX IF NOT EXISTS "idx_guest_checkins_owner_booking" ON "guest_checkins" ("owner_id", "booking_id");
CREATE INDEX IF NOT EXISTS "idx_messages_booking_sent" ON "guest_messages" ("booking_id", "sent_at");
CREATE INDEX IF NOT EXISTS "idx_housekeeping_owner_status" ON "housekeeping_tasks" ("owner_id", "status");
CREATE INDEX IF NOT EXISTS "idx_mandatory_charges_owner_active" ON "mandatory_charges" ("owner_id", "active");

ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "name_el" TEXT NOT NULL DEFAULT '';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "name_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "description_el" TEXT NOT NULL DEFAULT '';
ALTER TABLE "extras" ADD COLUMN IF NOT EXISTS "description_en" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mandatory_charges" ADD COLUMN IF NOT EXISTS "name_el" TEXT NOT NULL DEFAULT '';
ALTER TABLE "mandatory_charges" ADD COLUMN IF NOT EXISTS "name_en" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS "idx_payment_policies_owner" ON "payment_policies" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_payments_booking" ON "payment_transactions" ("booking_id");
CREATE INDEX IF NOT EXISTS "idx_payments_provider_reference" ON "payment_transactions" ("provider", "provider_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_quotes_owner_reference" ON "quotes" ("owner_id", "reference");
CREATE INDEX IF NOT EXISTS "idx_quotes_owner_status_expiry" ON "quotes" ("owner_id", "status", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_rate_plans_owner" ON "rate_plans" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_rate_rules_owner_dates" ON "rate_rules" ("owner_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "idx_room_categories_owner_order" ON "room_categories" ("owner_id", "display_order");
CREATE INDEX IF NOT EXISTS "idx_room_amenities_owner_order" ON "room_amenities" ("owner_id", "display_order");
CREATE INDEX IF NOT EXISTS "idx_special_prices_owner_dates" ON "special_prices" ("owner_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "idx_booking_restrictions_owner_dates" ON "booking_restrictions" ("owner_id", "starts_on", "ends_on");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_pms_sessions_token_hash" ON "pms_sessions" ("token_hash");
CREATE INDEX IF NOT EXISTS "idx_pms_sessions_owner_expiry" ON "pms_sessions" ("owner_id", "expires_at");
CREATE INDEX IF NOT EXISTS "idx_pms_dashboard_notes_owner_updated" ON "pms_dashboard_notes" ("owner_id", "updated_at");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rate_widget_settings_owner" ON "rate_widget_settings" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_reminder_workflows_owner_stage" ON "reminder_workflows" ("owner_id", "stage");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_revenue_settings_owner" ON "revenue_settings" ("owner_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_rooms_owner_code" ON "rooms" ("owner_id", "code");

-- 2027 metadata: additive, safe to apply again to an existing PMS database.
-- Attributes are an object so JSONB containment queries (attributes @> ...) work.
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "ai_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "guest_segment" TEXT NOT NULL DEFAULT 'leisure';
ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "ai_upsell_logs" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "booking_sessions" ADD COLUMN IF NOT EXISTS "device_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "checked_in_at" BIGINT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "checked_out_at" BIGINT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_phone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "guest_country" TEXT NOT NULL DEFAULT '';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "adults" BIGINT NOT NULL DEFAULT 1;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "children" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "special_requests" TEXT NOT NULL DEFAULT '';
ALTER TABLE "guest_preferences" ADD COLUMN IF NOT EXISTS "ai_guest_summary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "booking_messages" ADD COLUMN IF NOT EXISTS "ai_intent" TEXT;
ALTER TABLE "booking_messages" ADD COLUMN IF NOT EXISTS "ai_sentiment" TEXT NOT NULL DEFAULT 'neutral';
ALTER TABLE "booking_messages" ADD COLUMN IF NOT EXISTS "is_handled_by_ai" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "booking_messages" ADD COLUMN IF NOT EXISTS "external_event_id" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_booking_messages_external_event" ON "booking_messages" ("owner_id", "external_event_id") WHERE "external_event_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "mydata_invoice_sync" (
  "id" BIGSERIAL PRIMARY KEY,
  "owner_id" TEXT NOT NULL,
  "folio_entry_id" BIGINT NOT NULL,
  "mark" TEXT,
  "uid" TEXT,
  "qr_url" TEXT,
  "sync_status" TEXT NOT NULL DEFAULT 'pending',
  "error_log" TEXT,
  "updated_at" BIGINT NOT NULL,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_mydata_invoice_sync_owner_folio" ON "mydata_invoice_sync" ("owner_id", "folio_entry_id");
CREATE INDEX IF NOT EXISTS "idx_rooms_attributes_jsonb" ON "rooms" USING gin ("attributes");
CREATE TABLE IF NOT EXISTS "app_key_fingerprints" (
  "owner_id" TEXT NOT NULL,
  "app_role" TEXT NOT NULL,
  "key_fingerprint" TEXT NOT NULL,
  "updated_at" BIGINT NOT NULL,
  PRIMARY KEY ("owner_id", "app_role")
);
CREATE INDEX IF NOT EXISTS "idx_booking_messages_ai_triage" ON "booking_messages" ("owner_id", "is_handled_by_ai", "read_at") WHERE "read_at" IS NULL;
-- The bookings primary key already indexes id; an additional (id, version) index is unnecessary.

CREATE TABLE IF NOT EXISTS pms_user_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  actor_id BIGINT NOT NULL,
  target_user_id BIGINT NOT NULL,
  action TEXT NOT NULL,
  changes_json TEXT NOT NULL DEFAULT '{}',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pms_user_audit_owner_target ON pms_user_audit(owner_id,target_user_id,created_at);

-- Per-language public booking copy. Existing Greek/English columns remain as fallback.
ALTER TABLE room_categories ADD COLUMN IF NOT EXISTS name_translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE room_categories ADD COLUMN IF NOT EXISTS description_translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE extras ADD COLUMN IF NOT EXISTS name_translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE extras ADD COLUMN IF NOT EXISTS description_translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE mandatory_charges ADD COLUMN IF NOT EXISTS name_translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS name_translations_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE housekeeping_tasks ADD COLUMN IF NOT EXISTS started_at BIGINT;
CREATE INDEX IF NOT EXISTS idx_folio_owner_created ON folio_entries(owner_id,created_at,entry_type);
CREATE INDEX IF NOT EXISTS idx_housekeeping_owner_completed ON housekeeping_tasks(owner_id,completed_at);

-- Scheduled guest communication, separated by event and delivery channel.
CREATE TABLE IF NOT EXISTS message_automation_settings (
 owner_id TEXT PRIMARY KEY,
 enabled BIGINT NOT NULL DEFAULT 0,
 email_enabled BIGINT NOT NULL DEFAULT 1,
 whatsapp_enabled BIGINT NOT NULL DEFAULT 0,
 checkin_days_before BIGINT NOT NULL DEFAULT 3,
 balance_days_before_checkout BIGINT NOT NULL DEFAULT 1,
 review_days_after_checkout BIGINT NOT NULL DEFAULT 2,
 send_hour BIGINT NOT NULL DEFAULT 10,
 review_url TEXT NOT NULL DEFAULT '',
 templates_json TEXT NOT NULL DEFAULT '{}',
 updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_deliveries (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 event_key TEXT NOT NULL,
 channel TEXT NOT NULL,
 scheduled_at BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts BIGINT NOT NULL DEFAULT 0,
 last_error TEXT,
 provider_reference TEXT,
 sent_at BIGINT,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL,
 UNIQUE(owner_id,booking_id,event_key,channel)
);
CREATE INDEX IF NOT EXISTS idx_message_deliveries_due ON message_deliveries(owner_id,status,scheduled_at);
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS checkout_session_id TEXT;
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS checkout_url TEXT;
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS checkout_expires_at BIGINT;
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS amount_cents BIGINT;
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS paid_at BIGINT;
ALTER TABLE balance_payment_links ADD COLUMN IF NOT EXISTS token_encrypted TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS whatsapp_opt_in BIGINT NOT NULL DEFAULT 0;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS whatsapp_opt_in BIGINT NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS automation_access_tokens (
 owner_id TEXT NOT NULL,booking_id BIGINT NOT NULL,kind TEXT NOT NULL,
 token_encrypted TEXT NOT NULL,expires_at BIGINT NOT NULL,
 PRIMARY KEY(owner_id,booking_id,kind)
);
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS events_json TEXT NOT NULL DEFAULT '{"confirmation":true,"checkin":true,"balance":true,"review":false}';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email_marketing_opt_in BIGINT NOT NULL DEFAULT 0;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS email_marketing_opt_in BIGINT NOT NULL DEFAULT 0;

-- Staff notifications (direct bookings, OTA changes, housekeeping alerts). Guest messages and arrivals are derived at read time.
CREATE TABLE IF NOT EXISTS pms_notifications (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 title_el TEXT NOT NULL,
 title_en TEXT NOT NULL,
 link TEXT NOT NULL DEFAULT '/pms',
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pms_notifications_owner_created ON pms_notifications(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_owner_phone ON bookings(owner_id,guest_phone);

-- Unified administrative and security audit trail (who, from where, what, before/after).
CREATE TABLE IF NOT EXISTS audit_logs (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 user_id BIGINT,
 action TEXT NOT NULL,
 entity_name TEXT NOT NULL,
 entity_id TEXT,
 payload_before JSONB,
 payload_after JSONB,
 ip_address TEXT NOT NULL DEFAULT '',
 user_agent TEXT NOT NULL DEFAULT '',
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_owner_created ON audit_logs(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_owner_user ON audit_logs(owner_id,user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_owner_entity ON audit_logs(owner_id,entity_name,created_at DESC);

-- Folio v2: per-night accommodation rates, charge categories and billing details per payer.
CREATE TABLE IF NOT EXISTS booking_nightly_rates (
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 stay_date TEXT NOT NULL,
 amount_cents BIGINT NOT NULL,
 original_cents BIGINT NOT NULL,
 payer TEXT NOT NULL DEFAULT 'guest',
 updated_by TEXT NOT NULL DEFAULT 'system',
 updated_at BIGINT NOT NULL,
 PRIMARY KEY (owner_id, booking_id, stay_date)
);
ALTER TABLE folio_entries ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS folio_initialized_at BIGINT;
CREATE TABLE IF NOT EXISTS booking_payers (
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 payer_type TEXT NOT NULL,
 name TEXT NOT NULL DEFAULT '',
 vat_number TEXT NOT NULL DEFAULT '',
 tax_office TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '',
 updated_at BIGINT NOT NULL,
 PRIMARY KEY (owner_id, booking_id, payer_type)
);

-- Identity-data retention and personal birthday offers.
ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS identity_purged_at BIGINT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS restricted_email TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS minimum_age BIGINT;
CREATE INDEX IF NOT EXISTS idx_guest_checkins_owner_email ON guest_checkins(owner_id,lower(email));
ALTER TABLE guest_preferences ADD COLUMN IF NOT EXISTS dietary TEXT NOT NULL DEFAULT '';
ALTER TABLE guest_preferences ADD COLUMN IF NOT EXISTS allergies TEXT NOT NULL DEFAULT '';
ALTER TABLE guest_preferences ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT '';

-- The specification forbids storing photos: clear any legacy housekeeping photo data.
UPDATE housekeeping_tasks SET photo_data=NULL WHERE photo_data IS NOT NULL;

-- Direct-website discount shown against the standard rate (PMS → Rates).
ALTER TABLE revenue_settings ADD COLUMN IF NOT EXISTS direct_discount_percent BIGINT NOT NULL DEFAULT 5;
ALTER TABLE revenue_settings ADD COLUMN IF NOT EXISTS direct_discount_active BIGINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_booking_sessions_coupon ON booking_sessions(owner_id,coupon_code) WHERE coupon_code IS NOT NULL;

-- Saved payment method for automatic balance collection (Stripe off-session), and collection attempts.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_provider TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_customer_ref TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method_ref TEXT;
CREATE TABLE IF NOT EXISTS balance_collection_attempts (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 amount_cents BIGINT NOT NULL,
 status TEXT NOT NULL,
 provider_reference TEXT,
 error TEXT,
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balance_attempts_booking ON balance_collection_attempts(owner_id,booking_id,created_at DESC);

-- Tax documents sent to AADE myDATA (receipts 11.2, invoices 2.1) with sequential numbering and a retry queue.
CREATE TABLE IF NOT EXISTS fiscal_series (
 owner_id TEXT NOT NULL,
 series TEXT NOT NULL,
 invoice_type TEXT NOT NULL,
 last_number BIGINT NOT NULL DEFAULT 0,
 PRIMARY KEY (owner_id, series, invoice_type)
);
CREATE TABLE IF NOT EXISTS fiscal_documents (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 payer TEXT NOT NULL,
 invoice_type TEXT NOT NULL,
 series TEXT NOT NULL,
 aa BIGINT NOT NULL,
 issue_date TEXT NOT NULL,
 buckets_json TEXT NOT NULL,
 payments_json TEXT NOT NULL DEFAULT '[]',
 document_json TEXT NOT NULL,
 total_cents BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 mark TEXT,
 uid TEXT,
 qr_url TEXT,
 cancellation_mark TEXT,
 attempts BIGINT NOT NULL DEFAULT 0,
 last_error TEXT,
 next_attempt_at BIGINT,
 environment TEXT NOT NULL DEFAULT 'dev',
 created_by TEXT NOT NULL,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL,
 UNIQUE (owner_id, series, invoice_type, aa)
);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_booking ON fiscal_documents(owner_id,booking_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_queue ON fiscal_documents(owner_id,status,next_attempt_at);

-- Channel manager: room type mapping, availability outbox and OTA reservation import.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS external_reservation_id TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS external_channel TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_external ON bookings(owner_id,external_channel,external_reservation_id,room_id) WHERE external_reservation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS channel_room_mappings (
 owner_id TEXT NOT NULL,
 room_type TEXT NOT NULL,
 external_room_type_id TEXT NOT NULL,
 updated_at BIGINT NOT NULL,
 PRIMARY KEY (owner_id, room_type)
);
CREATE TABLE IF NOT EXISTS channel_sync_outbox (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 date_from TEXT NOT NULL,
 date_to TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending',
 attempts BIGINT NOT NULL DEFAULT 0,
 last_error TEXT,
 next_attempt_at BIGINT NOT NULL DEFAULT 0,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channel_outbox_due ON channel_sync_outbox(owner_id,status,next_attempt_at);
CREATE TABLE IF NOT EXISTS channel_import_log (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 revision_id TEXT NOT NULL,
 status TEXT NOT NULL,
 booking_ids TEXT NOT NULL DEFAULT '[]',
 error TEXT,
 created_at BIGINT NOT NULL,
 UNIQUE (owner_id, revision_id)
);

-- Decisions on rule-based dynamic pricing suggestions (approved ones become special prices).
CREATE TABLE IF NOT EXISTS pricing_suggestion_decisions (
 owner_id TEXT NOT NULL,
 suggestion_key TEXT NOT NULL,
 decision TEXT NOT NULL,
 special_price_id BIGINT,
 decided_by TEXT NOT NULL,
 decided_at BIGINT NOT NULL,
 PRIMARY KEY (owner_id, suggestion_key)
);

-- Social media: posts with a human approval gate, and inbound Facebook/Instagram messages (DM-to-booking).
CREATE TABLE IF NOT EXISTS social_posts (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 channels TEXT NOT NULL DEFAULT '[]',
 caption TEXT NOT NULL,
 image_url TEXT NOT NULL DEFAULT '',
 link_url TEXT NOT NULL DEFAULT '',
 scheduled_at BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'draft',
 created_by BIGINT NOT NULL,
 approved_by BIGINT,
 approved_at BIGINT,
 results_json TEXT NOT NULL DEFAULT '{}',
 attempts BIGINT NOT NULL DEFAULT 0,
 published_at BIGINT,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_due ON social_posts(owner_id,status,scheduled_at);
CREATE TABLE IF NOT EXISTS social_messages (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 platform TEXT NOT NULL,
 sender_id TEXT NOT NULL,
 direction TEXT NOT NULL,
 body TEXT NOT NULL,
 external_id TEXT,
 status TEXT NOT NULL DEFAULT 'new',
 sent_by BIGINT,
 created_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_messages_external ON social_messages(owner_id,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_messages_thread ON social_messages(owner_id,platform,sender_id,created_at);

-- v48: birthday code stay-date rules (allowed stay window and excluded periods, e.g. 07-20 → 08-20)
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS stay_from TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS stay_to TEXT;
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS blackout_json TEXT NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS birthday_settings (
 owner_id TEXT PRIMARY KEY,
 discount_percent BIGINT NOT NULL DEFAULT 10,
 valid_days BIGINT NOT NULL DEFAULT 60,
 stay_from TEXT,
 stay_to TEXT,
 blackout_json TEXT NOT NULL DEFAULT '[]',
 updated_by BIGINT,
 updated_at BIGINT NOT NULL
);

-- v48: maintenance notices. Never deleted: resolution adds timestamped metadata so management keeps the full history.
CREATE TABLE IF NOT EXISTS maintenance_notices (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 room_id BIGINT NOT NULL,
 housekeeping_task_id BIGINT,
 severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN ('minor','major','out_of_order')),
 description TEXT NOT NULL,
 reported_by BIGINT,
 reported_at BIGINT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
 resolved_by BIGINT,
 resolved_at BIGINT,
 resolution_notes TEXT,
 labor_hours NUMERIC(6,2),
 cost_cents BIGINT,
 vendor_reference TEXT,
 post_repair_state TEXT CHECK (post_repair_state IS NULL OR post_repair_state IN ('clean','dirty')),
 CHECK (status='open' OR (resolved_at IS NOT NULL AND resolution_notes IS NOT NULL AND length(trim(resolution_notes))>0))
);
CREATE INDEX IF NOT EXISTS idx_maintenance_notices_open ON maintenance_notices(owner_id,room_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS idx_maintenance_notices_history ON maintenance_notices(owner_id,reported_at DESC);
CREATE TABLE IF NOT EXISTS maintenance_notice_photos (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 notice_id BIGINT NOT NULL REFERENCES maintenance_notices(id),
 mime TEXT NOT NULL,
 data_base64 TEXT NOT NULL,
 byte_size BIGINT NOT NULL,
 uploaded_by BIGINT,
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_maintenance_photos_notice ON maintenance_notice_photos(owner_id,notice_id);
CREATE OR REPLACE FUNCTION corali_keep_maintenance_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'maintenance history is append-only; resolve notices instead of deleting them';
END;
$$;
DROP TRIGGER IF EXISTS trg_maintenance_notices_no_delete ON maintenance_notices;
CREATE TRIGGER trg_maintenance_notices_no_delete BEFORE DELETE ON maintenance_notices FOR EACH ROW EXECUTE PROCEDURE corali_keep_maintenance_history();
DROP TRIGGER IF EXISTS trg_maintenance_photos_no_delete ON maintenance_notice_photos;
CREATE TRIGGER trg_maintenance_photos_no_delete BEFORE DELETE ON maintenance_notice_photos FOR EACH ROW EXECUTE PROCEDURE corali_keep_maintenance_history();

-- v48: arrival instructions (per mode/hub templates) and transfer ordering
CREATE TABLE IF NOT EXISTS arrival_settings (
 owner_id TEXT PRIMARY KEY,
 settings_json TEXT NOT NULL DEFAULT '{}',
 updated_by BIGINT,
 updated_at BIGINT NOT NULL
);
ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS arrival_mode TEXT;
ALTER TABLE guest_checkins ADD COLUMN IF NOT EXISTS arrival_hub TEXT;
CREATE TABLE IF NOT EXISTS transfer_requests (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 guest_checkin_id BIGINT,
 arrival_mode TEXT NOT NULL,
 arrival_hub TEXT NOT NULL,
 vehicle_key TEXT NOT NULL,
 vehicle_name TEXT NOT NULL,
 passengers BIGINT NOT NULL,
 price_cents BIGINT NOT NULL,
 arrival_time TEXT,
 travel_details TEXT,
 folio_entry_id BIGINT,
 status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','cancelled')),
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_booking ON transfer_requests(owner_id,booking_id);

-- v48: guest messaging pipeline (72h pre-arrival, welcome, pre-departure) and post-stay review shield
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS tripadvisor_url TEXT NOT NULL DEFAULT '';
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS pre_arrival_hour BIGINT NOT NULL DEFAULT 15;
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS welcome_hour BIGINT NOT NULL DEFAULT 16;
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS pre_departure_hour BIGINT NOT NULL DEFAULT 18;
CREATE TABLE IF NOT EXISTS review_requests (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 booking_id BIGINT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 token_encrypted TEXT NOT NULL,
 expires_at BIGINT NOT NULL,
 rating BIGINT CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
 route TEXT CHECK (route IS NULL OR route IN ('public','private')),
 comment TEXT,
 contact_ok BIGINT NOT NULL DEFAULT 0,
 public_clicked TEXT,
 status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','rated','feedback','resolved')),
 created_at BIGINT NOT NULL,
 rated_at BIGINT,
 resolved_by BIGINT,
 resolved_at BIGINT,
 resolution_notes TEXT,
 UNIQUE(owner_id,booking_id)
);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(owner_id,status,rated_at DESC);

-- v48: revenue strategy analytics (pace & pickup, channel net yield, competitor rates)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancelled_at BIGINT;
CREATE OR REPLACE FUNCTION corali_booking_cancelled_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  ELSIF NEW.status <> 'cancelled' THEN
    NEW.cancelled_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_bookings_cancelled_at ON bookings;
CREATE TRIGGER trg_bookings_cancelled_at BEFORE INSERT OR UPDATE OF status ON bookings FOR EACH ROW EXECUTE PROCEDURE corali_booking_cancelled_at();
CREATE INDEX IF NOT EXISTS idx_bookings_pace ON bookings(owner_id,check_in,check_out);
CREATE TABLE IF NOT EXISTS channel_commissions (
 owner_id TEXT NOT NULL,
 channel TEXT NOT NULL,
 commission_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (commission_percent BETWEEN 0 AND 60),
 payment_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (payment_fee_percent BETWEEN 0 AND 20),
 updated_by BIGINT,
 updated_at BIGINT NOT NULL,
 PRIMARY KEY(owner_id,channel)
);
CREATE TABLE IF NOT EXISTS competitors (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 name TEXT NOT NULL,
 website TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','api')),
 api_url TEXT NOT NULL DEFAULT '',
 active BIGINT NOT NULL DEFAULT 1,
 last_fetch_at BIGINT,
 last_fetch_error TEXT,
 created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS competitor_rates (
 owner_id TEXT NOT NULL,
 competitor_id BIGINT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
 stay_date TEXT NOT NULL,
 rate_cents BIGINT,
 previous_rate_cents BIGINT,
 sold_out BIGINT NOT NULL DEFAULT 0,
 source TEXT NOT NULL DEFAULT 'manual',
 captured_at BIGINT NOT NULL,
 PRIMARY KEY(owner_id,competitor_id,stay_date)
);

-- v48: DM-to-booking drafts with live availability (reviewed and sent by reception)
ALTER TABLE social_messages ADD COLUMN IF NOT EXISTS suggested_reply TEXT;
ALTER TABLE social_messages ADD COLUMN IF NOT EXISTS stay_request_json TEXT;

-- v49: payment terms per rate plan (cancellation policy) and booking policy texts per language
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS deposit_percent BIGINT CHECK (deposit_percent IS NULL OR deposit_percent BETWEEN 0 AND 100);
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS balance_mode TEXT NOT NULL DEFAULT 'general';
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS balance_days_before BIGINT;
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS full_prepayment BIGINT NOT NULL DEFAULT 0;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS balance_charge_days BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS balance_charge_days BIGINT;
CREATE TABLE IF NOT EXISTS booking_policy_texts (
 owner_id TEXT PRIMARY KEY,
 texts_json TEXT NOT NULL DEFAULT '{}',
 updated_by BIGINT,
 updated_at BIGINT NOT NULL
);
-- The Greek climate crisis resilience fee is charged per room per night, never per booking.
UPDATE mandatory_charges SET calculation_mode='per_room_night'
 WHERE calculation_mode='per_booking' AND (category IN ('climate_resilience','climate_tax') OR name ILIKE '%climate%' OR name ILIKE '%κλιματ%' OR COALESCE(name_el,'') ILIKE '%κλιματ%' OR COALESCE(name_en,'') ILIKE '%climate%');

-- v49: room photos uploaded from the PMS (served publicly to the booking engine) and per-user dashboard layout
CREATE TABLE IF NOT EXISTS room_photos (
 id BIGSERIAL PRIMARY KEY,
 owner_id TEXT NOT NULL,
 room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 mime TEXT NOT NULL,
 data_base64 TEXT NOT NULL,
 byte_size BIGINT NOT NULL,
 sort_order BIGINT NOT NULL DEFAULT 0,
 created_by BIGINT,
 created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_photos_room ON room_photos(owner_id,room_id,sort_order);
CREATE TABLE IF NOT EXISTS pms_dashboard_layouts (
 owner_id TEXT NOT NULL,
 staff_user_id BIGINT NOT NULL,
 layout_json TEXT NOT NULL,
 updated_at BIGINT NOT NULL,
 PRIMARY KEY(owner_id,staff_user_id)
);
ALTER TABLE room_amenities ADD COLUMN IF NOT EXISTS name_translations_json TEXT NOT NULL DEFAULT '{}';

-- v50: season prices (nightly price per period for all rooms, a room type or specific rooms), managed in PMS → Pricing
ALTER TABLE "rate_rules" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT '';
ALTER TABLE "rate_rules" ADD COLUMN IF NOT EXISTS "room_codes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "rate_rules" ADD COLUMN IF NOT EXISTS "weekdays" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "rate_rules" ADD COLUMN IF NOT EXISTS "active" BIGINT NOT NULL DEFAULT 1;
ALTER TABLE "rate_rules" ADD COLUMN IF NOT EXISTS "updated_at" BIGINT NOT NULL DEFAULT 0;

-- v51: minimum stay per room category (room type): all-year value and per-period values, checked on the check-in date
CREATE TABLE IF NOT EXISTS "min_stay_rules" (
  "id" BIGSERIAL PRIMARY KEY NOT NULL,
  "owner_id" TEXT NOT NULL,
  "room_type" TEXT,
  "starts_on" TEXT,
  "ends_on" TEXT,
  "min_nights" BIGINT NOT NULL DEFAULT 1,
  "active" BIGINT NOT NULL DEFAULT 1,
  "updated_at" BIGINT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_min_stay_rules_owner" ON "min_stay_rules" ("owner_id", "room_type");

-- v52: the climate resilience fee match above missed Greek capitals on C-locale databases; match common spellings explicitly.
UPDATE mandatory_charges SET calculation_mode='per_room_night'
 WHERE calculation_mode<>'per_room_night' AND (
   COALESCE(name,'')||' '||COALESCE(name_el,'')||' '||COALESCE(name_en,'')||' '||COALESCE(name_translations_json,'') ~* '(κλιματ|Κλιματ|ΚΛΙΜΑΤ|ανθεκτικ|Ανθεκτικ|ΑΝΘΕΚΤΙΚ|climate|resilience)');

-- v52: databases created before sticky-note colours existed kept the old pms_dashboard_notes table (CREATE TABLE IF NOT EXISTS
-- never adds columns); add them explicitly so the dashboard notes load.
ALTER TABLE "pms_dashboard_notes" ADD COLUMN IF NOT EXISTS "color" TEXT NOT NULL DEFAULT 'yellow';
ALTER TABLE "pms_dashboard_notes" ADD COLUMN IF NOT EXISTS "created_at" BIGINT NOT NULL DEFAULT 0;

-- Promotions (VikBooking-style special prices): guest-facing text, last-minute / early-booking windows,
-- arrival within the period, rounding and per-length value overrides.
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS promotion_text_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS last_minute_days BIGINT;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS min_advance_days BIGINT;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS checkin_in_season BIGINT NOT NULL DEFAULT 0;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS round_integer BIGINT NOT NULL DEFAULT 0;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS nights_overrides_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS updated_at BIGINT;
-- v60: offers choose which other discounts they combine with (1 = yes, 0 = the guest gets the better of the two).
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS combine_offers BIGINT NOT NULL DEFAULT 1;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS combine_plan BIGINT NOT NULL DEFAULT 1;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS combine_direct BIGINT NOT NULL DEFAULT 1;
ALTER TABLE special_prices ADD COLUMN IF NOT EXISTS combine_coupons BIGINT NOT NULL DEFAULT 1;
-- v61: Stripe "Authorization" payment type — the hold to capture or release from the reservation.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_authorization_ref TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_authorized_cents BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_authorized_at BIGINT;
-- v61: free-cancellation days per rate plan (NULL = the general cancellation policy of the period), carried to the booking.
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS cancellation_days BIGINT;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS cancellation_days BIGINT;
-- v62: after a failed automatic balance charge the guest gets a payment link with a 48-hour deadline; unpaid → cancelled.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS balance_deadline_at BIGINT;
-- v63: triggered guest messages (payment problem, cancellation) carry their details (reason, refund, deadline).
ALTER TABLE message_deliveries ADD COLUMN IF NOT EXISTS payload_json TEXT NOT NULL DEFAULT '{}';
-- v63: partly refundable rate plans — share of the amount paid that is refunded when cancelled in time (NULL = 100%).
ALTER TABLE rate_plans ADD COLUMN IF NOT EXISTS refund_percent BIGINT;
ALTER TABLE booking_sessions ADD COLUMN IF NOT EXISTS refund_percent BIGINT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refund_percent BIGINT;
-- v64: the "Partly refundable" rate plan is always listed in Payment policy (inactive until switched on there).
INSERT INTO rate_plans(owner_id,plan_key,name,adjustment_percent,payment_policy,active,deposit_percent,balance_mode,full_prepayment,cancellation_days,refund_percent,updated_at)
SELECT DISTINCT owner_id,'partly_refundable','Partly refundable',-5,'flexible',0,50,'general',0,30,50,0 FROM rate_plans
ON CONFLICT (owner_id,plan_key) DO NOTHING;
-- v65: AI help for guest messages — automatic replies are marked, and the switch lives with the automation settings.
ALTER TABLE booking_messages ADD COLUMN IF NOT EXISTS ai_generated BIGINT NOT NULL DEFAULT 0;
ALTER TABLE message_automation_settings ADD COLUMN IF NOT EXISTS ai_auto_reply BIGINT NOT NULL DEFAULT 0;
