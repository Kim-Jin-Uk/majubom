-- 0011_notifications_business_idx — 사업장별 일일 발송 한도를 세는 인덱스 (FR-NOTI-020, #97).
-- 없으면 알림 한 건 보낼 때마다 notifications 를 통째로 훑는다. 알림은 가장 빨리 자라는 표다.
CREATE INDEX "notifications_business_created_idx" ON "notifications" USING btree ("business_id","created_at");