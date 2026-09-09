-- 0003_work_exception_status — 근무 예외 상태 (에픽 #37 · 매니저 휴가 신청). 전부 expand 전용.
--   work_exceptions: status(기본 APPROVED — 기존 행은 전부 적용 중인 예외라 기본값이 맞다), decided_by / decided_at / decision_note(nullable)
-- 락: ADD COLUMN ... DEFAULT 상수 NOT NULL 은 PG11+ 에서 테이블 재작성 없음(카탈로그 기본값). CREATE INDEX(비-CONCURRENTLY) 는 SHARE — 1기라 그대로.
-- 감사 action 값 추가(LEAVE_APPROVE/LEAVE_DENY)는 0004 로 분리 (enum 값 추가는 별도 파일 — 08 §5.2 정정 3).
-- 이 파일은 drizzle-kit generate 산출물을 둘로 나눈 것 + 이 주석.
CREATE TYPE "public"."work_exception_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD COLUMN "status" "work_exception_status" DEFAULT 'APPROVED' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD COLUMN "decision_note" varchar(200);--> statement-breakpoint
ALTER TABLE "work_exceptions" ADD CONSTRAINT "work_exceptions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_exceptions_business_status_idx" ON "work_exceptions" USING btree ("business_id","status");