-- 0004_audit_leave_actions — audit_action 에 LEAVE_APPROVE · LEAVE_DENY 추가 (매니저 휴가 신청 승인·반려 감사).
-- enum 값 추가는 같은 트랜잭션에서 그 값을 쓸 수 없으므로 별도 파일 (08 §5.2 정정 3).
ALTER TYPE "public"."audit_action" ADD VALUE 'LEAVE_APPROVE' BEFORE 'RESERVATION_STATUS_CHANGE';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'LEAVE_DENY' BEFORE 'RESERVATION_STATUS_CHANGE';
