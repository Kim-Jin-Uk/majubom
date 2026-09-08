-- 0002_auth — 인증·계정 (에픽 #15). 전부 expand 전용: 새 타입·새 테이블·nullable 컬럼 추가만 있다.
--   users: provider_account_id(소셜 식별자, (provider, provider_account_id) unique — NULL 은 서로 다름),
--          email_verified_at, totp_secret_enc / totp_enabled_at / totp_last_step (ADMIN 2FA)
--   sessions: prev_token_hash / rotated_at (리프레시 회전 유예)
--   auth_tokens: 단일사용 토큰 (EMAIL_OTP · EMAIL_VERIFY · INVITE · PASSWORD_RESET). user_id nullable(IP 카운터 보존)
-- 락 (08 §5.6 "어떤 락을, 얼마나, 무엇을 막으며"):
--   · ADD COLUMN(nullable, 기본값 없음): ACCESS EXCLUSIVE 를 순간만. 테이블 재작성 없음
--   · CREATE INDEX (비-CONCURRENTLY): SHARE — 빌드 동안 해당 테이블 쓰기 차단, 읽기는 통과
--   · ADD CONSTRAINT ... UNIQUE(users): ACCESS EXCLUSIVE — 인덱스 빌드 동안 users 읽기까지 차단.
--     1기(W1–W15, 08 §5.1)라 그대로 두었다. W16 이후 재적용·스쿼시 시에는 CREATE UNIQUE INDEX CONCURRENTLY →
--     ADD CONSTRAINT ... USING INDEX 로 쪼개 --custom 마이그레이션으로 낸다 (0001 과 같은 방식)
-- 배포 순서: 새 코드(refresh.ts)가 prev_token_hash 를 SELECT 하므로 마이그레이션이 먼저다 (migrate.yml → 롤아웃)
-- 이 파일은 drizzle-kit generate 산출물 + 이 주석. 손으로 고치지 않는다.
CREATE TYPE "public"."auth_token_kind" AS ENUM('EMAIL_OTP', 'EMAIL_VERIFY', 'INVITE', 'PASSWORD_RESET');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "auth_token_kind" NOT NULL,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_account_id" varchar(191);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "prev_token_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_tokens_user_kind_idx" ON "auth_tokens" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "auth_tokens_ip_created_idx" ON "auth_tokens" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_provider_account_uq" UNIQUE("provider","provider_account_id");