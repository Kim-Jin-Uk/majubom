-- 0007_reservations_replaces_idx — 예약 변경으로 대체된 원 예약을 빠르게 찾기 위한 부분 인덱스.
-- 취소 남용 카운트가 "변경으로 취소된 건" 을 빼려고 상관 서브쿼리를 돈다(transitions.ts canceledTodayCount).
-- 예약 생성 트랜잭션 안, 고객 락을 쥔 채 도는 자리라 seq scan 이면 곤란하다.
-- CONCURRENTLY 를 쓰지 않는 이유: 러너가 마이그레이션 파일을 트랜잭션 안에서 돌린다 (08 §5.2). 1기 규모에서 SHARE 락은 순간이다.
CREATE INDEX "reservations_replaces_idx" ON "reservations" USING btree ("replaces_reservation_id") WHERE "replaces_reservation_id" IS NOT NULL;
