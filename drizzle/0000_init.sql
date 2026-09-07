-- 08 §5.3 ③: resource_id(uuid) 에는 gist 기본 연산자 클래스가 없다. 이 확장이 없으면
-- 0001 의 EXCLUDE 제약 생성이 "data type uuid has no default operator class for access method gist" 로 죽는다.
-- 절대 DROP EXTENSION 하지 않는다 — 확장이 사라지면 제약도 함께 사라진다 (08 §5.3 ③, §5.4 금지 목록).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('BUSINESS_APPROVE', 'BUSINESS_REJECT', 'BUSINESS_SUSPEND', 'BUSINESS_BLOCK', 'BUSINESS_RESTORE', 'PLAN_LIMIT_UPDATE', 'MEMBER_CREATE', 'MEMBER_DEACTIVATE', 'MEMBER_PERMISSION_UPDATE', 'PRODUCT_DELETE', 'POLICY_UPDATE', 'SCHEDULE_UPDATE', 'SHIFT_APPROVE', 'SHIFT_DENY', 'HOLIDAY_BULK_CANCEL', 'RESERVATION_STATUS_CHANGE', 'RESERVATION_REASSIGN', 'RESERVATION_CREATE_WALKIN', 'SITE_PUBLISH', 'SITE_REVERT', 'REPORT_VIEW', 'REPORT_ACTION', 'CHAT_BLOCK', 'USER_SUSPEND', 'LOGIN_FAIL', 'PASSWORD_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."business_plan" AS ENUM('FREE', 'BASIC');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."created_via" AS ENUM('WEB', 'CHAT', 'WALK_IN');--> statement-breakpoint
CREATE TYPE "public"."event_group" AS ENUM('RESERVATION', 'CHAT', 'SCHEDULE', 'MARKETING');--> statement-breakpoint
CREATE TYPE "public"."global_role" AS ENUM('ADMIN', 'USER');--> statement-breakpoint
CREATE TYPE "public"."holiday_type" AS ENUM('ONCE', 'WEEKLY', 'MONTHLY_DAY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('OWNER', 'MANAGER');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('INVITED', 'ACTIVE', 'INACTIVE');--> statement-breakpoint
CREATE TYPE "public"."no_show_source" AS ENUM('MANUAL', 'AUTO');--> statement-breakpoint
CREATE TYPE "public"."notification_event_type" AS ENUM('BUSINESS_APPLIED', 'BUSINESS_APPROVED', 'BUSINESS_REJECTED', 'MEMBER_INVITED', 'RESERVATION_REQUESTED', 'RESERVATION_CONFIRMED', 'RESERVATION_REJECTED', 'RESERVATION_CANCELED_BY_USER', 'RESERVATION_CANCELED_BY_BIZ', 'RESERVATION_REMINDER', 'DAILY_RESERVATION_SUMMARY', 'REQUEST_PENDING', 'SHIFT_REQUESTED', 'SHIFT_RESPONDED', 'SHIFT_APPROVED', 'USAGE_LIMIT_80', 'RESERVATION_EXPIRED', 'CHAT_NEW_MESSAGE', 'CHAT_NEW_ROOM', 'CHAT_UNANSWERED', 'REPORT_RECEIVED', 'REPORT_RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'ACTIVE', 'HIDDEN', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('IOS', 'ANDROID', 'DESKTOP');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('PENDING', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('CHAT_ROOM', 'CHAT_MESSAGE', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELED_BY_USER', 'CANCELED_BY_BIZ', 'NO_SHOW', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."resource_select_mode" AS ENUM('REQUIRED', 'OPTIONAL', 'AUTO', 'NONE');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('STAFF', 'SPACE', 'SHARED');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('PUBLISHED', 'HIDDEN', 'REPORTED');--> statement-breakpoint
CREATE TYPE "public"."shift_swap_status" AS ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'APPROVED', 'DENIED', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."start_mode" AS ENUM('FREE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."swap_type" AS ENUM('GIVE', 'EXCHANGE');--> statement-breakpoint
CREATE TYPE "public"."user_provider" AS ENUM('LOCAL', 'KAKAO', 'GOOGLE');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'SUSPENDED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."work_exception_kind" AS ENUM('OFF', 'MODIFIED', 'BLOCK', 'EXTRA');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(32),
	"name" varchar(100) NOT NULL,
	"password_hash" text,
	"provider" "user_provider" NOT NULL,
	"global_role" "global_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "member_status" DEFAULT 'INVITED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_members_user_business_uq" UNIQUE("user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "business_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"slug" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_slug_history_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"biz_reg_no" varchar(20) NOT NULL,
	"category" varchar(50) NOT NULL,
	"phone" varchar(32),
	"address" text,
	"address_detail" text,
	"lat" double precision,
	"lng" double precision,
	"description" text,
	"timezone" varchar(64) DEFAULT 'Asia/Seoul' NOT NULL,
	"opening_hours" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "business_status" DEFAULT 'PENDING' NOT NULL,
	"plan" "business_plan" DEFAULT 'FREE' NOT NULL,
	"policy" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "businesses_slug_unique" UNIQUE("slug"),
	CONSTRAINT "businesses_biz_reg_no_unique" UNIQUE("biz_reg_no"),
	CONSTRAINT "businesses_slug_format" CHECK ("businesses"."slug" ~ '^[a-z0-9-]{3,30}$')
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"type" "resource_type" NOT NULL,
	"member_id" uuid,
	"name" varchar(100) NOT NULL,
	"image_url" text,
	"description" text,
	"capacity" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resources_member_id_unique" UNIQUE("member_id"),
	CONSTRAINT "resources_capacity_min" CHECK ("resources"."capacity" >= 1),
	CONSTRAINT "resources_member_only_staff" CHECK ("resources"."type" = 'STAFF' OR "resources"."member_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "product_resources" (
	"product_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	CONSTRAINT "product_resources_pk" PRIMARY KEY("product_id","resource_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_mode" "start_mode" NOT NULL,
	"fixed_start_times" jsonb,
	"slot_interval_min" integer,
	"duration_min" integer NOT NULL,
	"duration_options" integer[],
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"capacity_per_slot" integer DEFAULT 1 NOT NULL,
	"max_party_size" integer DEFAULT 1 NOT NULL,
	"price_display" varchar(50),
	"resource_select_mode" "resource_select_mode" NOT NULL,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_start_mode_shape" CHECK (("products"."start_mode" = 'FIXED' AND "products"."fixed_start_times" IS NOT NULL AND "products"."duration_options" IS NULL) OR ("products"."start_mode" = 'FREE' AND "products"."slot_interval_min" IN (10, 15, 20, 30, 60))),
	CONSTRAINT "products_duration_in_options" CHECK ("products"."duration_options" IS NULL OR "products"."duration_min" = ANY("products"."duration_options")),
	CONSTRAINT "products_positive_bounds" CHECK ("products"."capacity_per_slot" >= 1 AND "products"."max_party_size" >= 1 AND "products"."duration_min" BETWEEN 5 AND 480),
	CONSTRAINT "products_buffer_nonneg" CHECK ("products"."buffer_before_min" >= 0 AND "products"."buffer_after_min" >= 0)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid,
	"type" "holiday_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"day_of_week" integer,
	"day_of_month" integer,
	"is_last_day_of_month" boolean DEFAULT false NOT NULL,
	"month" integer,
	"is_full_day" boolean DEFAULT true NOT NULL,
	"start_time" time,
	"end_time" time,
	"repeat_until" date,
	"memo" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holidays_day_of_week_range" CHECK ("holidays"."day_of_week" IS NULL OR "holidays"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "holidays_day_of_month_range" CHECK ("holidays"."day_of_month" IS NULL OR "holidays"."day_of_month" BETWEEN 1 AND 31),
	CONSTRAINT "holidays_month_range" CHECK ("holidays"."month" IS NULL OR "holidays"."month" BETWEEN 1 AND 12),
	CONSTRAINT "holidays_date_order" CHECK ("holidays"."end_date" IS NULL OR "holidays"."start_date" <= "holidays"."end_date"),
	CONSTRAINT "holidays_partial_needs_times" CHECK ("holidays"."is_full_day" OR ("holidays"."start_time" IS NOT NULL AND "holidays"."end_time" IS NOT NULL AND "holidays"."start_time" < "holidays"."end_time"))
);
--> statement-breakpoint
CREATE TABLE "shift_swap_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"requester_resource_id" uuid NOT NULL,
	"target_resource_id" uuid NOT NULL,
	"request_date" date NOT NULL,
	"swap_type" "swap_type" NOT NULL,
	"target_date" date,
	"reason" text NOT NULL,
	"status" "shift_swap_status" DEFAULT 'PENDING' NOT NULL,
	"reassign_requester" boolean DEFAULT false NOT NULL,
	"reassign_target" boolean,
	"reservation_ids_at_request" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responded_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_swap_distinct_resources" CHECK ("shift_swap_requests"."requester_resource_id" <> "shift_swap_requests"."target_resource_id"),
	CONSTRAINT "shift_swap_exchange_needs_target_date" CHECK ("shift_swap_requests"."swap_type" = 'GIVE' OR "shift_swap_requests"."target_date" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "work_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "work_exception_kind" NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" varchar(200),
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_exceptions_times_by_kind" CHECK (("work_exceptions"."kind" = 'OFF') OR ("work_exceptions"."start_time" IS NOT NULL AND "work_exceptions"."end_time" IS NOT NULL AND "work_exceptions"."start_time" < "work_exceptions"."end_time"))
);
--> statement-breakpoint
CREATE TABLE "work_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"breaks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_schedules_day_of_week_range" CHECK ("work_schedules"."day_of_week" BETWEEN 0 AND 6),
	CONSTRAINT "work_schedules_time_order" CHECK ("work_schedules"."start_time" < "work_schedules"."end_time"),
	CONSTRAINT "work_schedules_effective_order" CHECK ("work_schedules"."effective_to" IS NULL OR "work_schedules"."effective_from" <= "work_schedules"."effective_to")
);
--> statement-breakpoint
CREATE TABLE "reservation_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"from_status" "reservation_status",
	"to_status" "reservation_status" NOT NULL,
	"from_resource_id" uuid,
	"to_resource_id" uuid,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(8) NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"occupy_range" "tstzrange" NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"duration_min" integer NOT NULL,
	"buffer_before_min" integer DEFAULT 0 NOT NULL,
	"buffer_after_min" integer DEFAULT 0 NOT NULL,
	"cancel_deadline_hours" integer NOT NULL,
	"party_size" integer DEFAULT 1 NOT NULL,
	"status" "reservation_status" NOT NULL,
	"no_show_source" "no_show_source",
	"customer_note" text,
	"internal_memo" text,
	"canceled_at" timestamp with time zone,
	"cancel_reason" text,
	"replaces_reservation_id" uuid,
	"created_via" "created_via" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_code_unique" UNIQUE("code"),
	CONSTRAINT "reservations_time_order_party" CHECK ("reservations"."start_at" < "reservations"."end_at" AND "reservations"."party_size" >= 1),
	CONSTRAINT "reservations_occupy_covers" CHECK ("reservations"."occupy_range" @> tstzrange("reservations"."start_at", "reservations"."end_at")),
	CONSTRAINT "reservations_occupy_derivation" CHECK ("reservations"."occupy_range" = tstzrange("reservations"."start_at" - ("reservations"."buffer_before_min" * interval '1 minute'), "reservations"."end_at" + ("reservations"."buffer_after_min" * interval '1 minute'), '[)')),
	CONSTRAINT "reservations_buffer_nonneg" CHECK ("reservations"."buffer_before_min" >= 0 AND "reservations"."buffer_after_min" >= 0),
	CONSTRAINT "reservations_no_show_source_only_no_show" CHECK ("reservations"."no_show_source" IS NULL OR "reservations"."status" = 'NO_SHOW')
);
--> statement-breakpoint
CREATE TABLE "review_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_replies_review_id_unique" UNIQUE("review_id")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"content" text NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'PUBLISHED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "reviews_rating_range" CHECK ("reviews"."rating" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"draft_data" jsonb NOT NULL,
	"published_data" jsonb,
	"previous_published_data" jsonb,
	"draft_version" integer DEFAULT 0 NOT NULL,
	"theme" jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_pages_business_id_unique" UNIQUE("business_id")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"event_group" "event_group" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_preferences_pk" PRIMARY KEY("user_id","event_group")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"business_id" uuid,
	"event_type" "notification_event_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"link_url" text NOT NULL,
	"channels" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fcm_token" text NOT NULL,
	"device_label" varchar(100),
	"platform" "push_platform" NOT NULL,
	"is_standalone" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_fcm_token_unique" UNIQUE("fcm_token")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_role" varchar(20),
	"business_id" uuid,
	"action" "audit_action" NOT NULL,
	"target_type" varchar(40),
	"target_id" text,
	"diff" jsonb,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" "report_status" DEFAULT 'PENDING' NOT NULL,
	"handled_by" uuid,
	"handled_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"business_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reservation_count" integer DEFAULT 0 NOT NULL,
	"notification_count" integer DEFAULT 0 NOT NULL,
	"active_manager_count" integer DEFAULT 0 NOT NULL,
	"product_count" integer DEFAULT 0 NOT NULL,
	"image_storage_mb" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"aggregated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_pk" PRIMARY KEY("business_id","date"),
	CONSTRAINT "usage_counters_nonneg" CHECK ("usage_counters"."reservation_count" >= 0 AND "usage_counters"."notification_count" >= 0 AND "usage_counters"."active_manager_count" >= 0 AND "usage_counters"."product_count" >= 0 AND "usage_counters"."image_storage_mb" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"device_label" varchar(100),
	"user_agent" text,
	"ip" "inet",
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_resources" ADD CONSTRAINT "product_resources_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_resources" ADD CONSTRAINT "product_resources_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_requester_resource_id_resources_id_fk" FOREIGN KEY ("requester_resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_swap_requests" ADD CONSTRAINT "shift_swap_requests_target_resource_id_resources_id_fk" FOREIGN KEY ("target_resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD CONSTRAINT "work_exceptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD CONSTRAINT "work_exceptions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD CONSTRAINT "work_exceptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_logs" ADD CONSTRAINT "reservation_logs_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_logs" ADD CONSTRAINT "reservation_logs_from_resource_id_resources_id_fk" FOREIGN KEY ("from_resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_logs" ADD CONSTRAINT "reservation_logs_to_resource_id_resources_id_fk" FOREIGN KEY ("to_resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_logs" ADD CONSTRAINT "reservation_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_replaces_reservation_id_reservations_id_fk" FOREIGN KEY ("replaces_reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_replies" ADD CONSTRAINT "review_replies_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_members_business_idx" ON "business_members" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "business_slug_history_business_idx" ON "business_slug_history" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "businesses_status_idx" ON "businesses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "resources_business_idx" ON "resources" USING btree ("business_id","sort_order");--> statement-breakpoint
CREATE INDEX "product_resources_resource_idx" ON "product_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "products_business_status_idx" ON "products" USING btree ("business_id","status","sort_order");--> statement-breakpoint
CREATE INDEX "holidays_business_idx" ON "holidays" USING btree ("business_id","start_date");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_business_status_idx" ON "shift_swap_requests" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "shift_swap_requests_target_idx" ON "shift_swap_requests" USING btree ("target_resource_id","status");--> statement-breakpoint
CREATE INDEX "work_exceptions_resource_date_idx" ON "work_exceptions" USING btree ("resource_id","date");--> statement-breakpoint
CREATE INDEX "work_schedules_resource_idx" ON "work_schedules" USING btree ("resource_id","day_of_week");--> statement-breakpoint
CREATE INDEX "reservation_logs_reservation_idx" ON "reservation_logs" USING btree ("reservation_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_resource_start_idx" ON "reservations" USING btree ("resource_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_customer_start_idx" ON "reservations" USING btree ("customer_id","start_at");--> statement-breakpoint
CREATE INDEX "reservations_business_status_idx" ON "reservations" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "reservations_business_start_idx" ON "reservations" USING btree ("business_id","start_at");--> statement-breakpoint
CREATE INDEX "reviews_business_created_idx" ON "reviews" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_business_created_idx" ON "audit_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_created_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id","expires_at");