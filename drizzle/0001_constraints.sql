-- drizzle-kit 이 표현하지 못하는 EXCLUDE 제약 2개. `drizzle-kit generate --custom` 으로 만든 파일이라
-- 0001_snapshot.json 은 0000 과 동일한 스키마를 가리키고, 드리프트 검사에 잡히지 않는다.
-- 이 파일을 수정·재생성하는 것은 "무중단 불가" 작업이다 (08 §5.3 ①②). 2기에는 MAINTENANCE_WRITE_LOCK 절차를 밟는다.

-- ── 사전 검증 (08 §5.5) — 첫 마이그레이션에서는 행이 0이지만, 스쿼시·재적용 시에도 같은 절차를 밟도록 남긴다.
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM reservations a JOIN reservations b
    ON a.id < b.id AND a.resource_id = b.resource_id AND a.occupy_range && b.occupy_range
   WHERE a.status IN ('REQUESTED','CONFIRMED') AND b.status IN ('REQUESTED','CONFIRMED')
     AND a.exclusive AND b.exclusive;
  IF n > 0 THEN RAISE EXCEPTION '겹치는 예약 % 쌍. no_overlap 제약 추가 중단', n; END IF;

  SELECT count(*) INTO n FROM work_schedules a JOIN work_schedules b
    ON a.id < b.id AND a.resource_id = b.resource_id AND a.day_of_week = b.day_of_week
   AND daterange(a.effective_from, a.effective_to, '[]') && daterange(b.effective_from, b.effective_to, '[]');
  IF n > 0 THEN RAISE EXCEPTION '겹치는 근무 패턴 % 쌍. work_schedule_no_overlap 제약 추가 중단', n; END IF;
END $$;--> statement-breakpoint

-- ── FR-BOOK-020 동시성 제어: 정원 1(exclusive) 이면서 슬롯을 점유 중인(REQUESTED/CONFIRMED) 예약만 대상.
-- exclusive 는 NOT NULL DEFAULT false 다. NULL 이면 술어가 NULL 로 떨어져 제약 사정권 밖이 된다 (08 §5.3 ④).
ALTER TABLE "reservations" ADD CONSTRAINT "no_overlap"
  EXCLUDE USING gist (
    "resource_id"  WITH =,
    "occupy_range" WITH &&
  ) WHERE ("exclusive" AND "status" IN ('REQUESTED', 'CONFIRMED'));--> statement-breakpoint

-- ── 02 §2.2 WorkSchedule: 같은 자원·같은 요일의 패턴 적용 기간은 겹칠 수 없다. effective_to NULL = 상한 무한.
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedule_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    "day_of_week" WITH =,
    daterange("effective_from", "effective_to", '[]') WITH &&
  );
