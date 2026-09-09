-- 0006_walkin_guest_label — 워크인 대리 등록의 표시용 이름 (FR-BOOK-070). expand 전용.
-- nullable ADD COLUMN 이라 테이블 재작성 없이 ACCESS EXCLUSIVE 를 순간만 잡는다 (08 §5.6).
-- 계정이 아니라 라벨이다: customer_id 는 사업장별 워크인 내부 계정(`walkin+{businessId}@internal`)이고,
-- 이 컬럼은 "현장에서 받아 적은 이름" 일 뿐이라 검증하지 않는다. 리뷰 자격은 created_via = WALK_IN 으로 걸러진다(FR-REV-010).
ALTER TABLE "reservations" ADD COLUMN "guest_label" varchar(60);
