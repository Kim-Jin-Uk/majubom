-- 0005_audit_business_update — audit_action 에 BUSINESS_UPDATE · MEMBER_REACTIVATE 추가.
-- 없어서 slug 변경이 POLICY_UPDATE 로, 매니저 재활성화가 MEMBER_PERMISSION_UPDATE 로 잘못 기록되고 있었다 (LATER.md L-20).
-- enum 값 추가는 같은 트랜잭션에서 그 값을 쓸 수 없으므로 이 파일에는 값 추가만 둔다 (08 §5.2 정정 3).
-- 배포 순서: 새 코드가 이 값들을 쓰므로 마이그레이션이 먼저다.
ALTER TYPE "public"."audit_action" ADD VALUE 'BUSINESS_UPDATE' BEFORE 'PLAN_LIMIT_UPDATE';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'MEMBER_REACTIVATE' BEFORE 'MEMBER_PERMISSION_UPDATE';