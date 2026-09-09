import { randomUUID } from "node:crypto";

/**
 * DB 회귀 테스트의 공용 픽스처 도구.
 *
 * `businesses.biz_reg_no` 는 **UNIQUE** 다. 다섯 파일이 전부 `String(Date.now()).slice(-10)` 으로 만들고 있었는데,
 * vitest 는 파일을 병렬로 돌리고 픽스처는 파일마다 첫 줄에서 만들어진다 — 같은 밀리초에 둘이 들어가면 23505 로 깨진다.
 * 로컬에서는 파일이 적어 잘 안 나고, CI 에서 파일이 하나 늘자 바로 터졌다.
 * 시간은 고유성의 근거가 아니다.
 */
export function fakeBizRegNo(): string {
  let digits = "";
  // uuid 하나에서 숫자만 뽑으면 열 자리가 안 될 수 있다. 0 으로 채우면 그 자리가 고정돼 충돌 확률이 올라간다
  while (digits.length < 10) digits += randomUUID().replace(/\D/g, "");
  return digits.slice(0, 10);
}

/** DB 회귀 테스트를 돌릴 수 있는가 — 이름에 test 가 든 DB 일 때만 (실 DB 를 건드리지 않는다) */
export function dbTestEnabled(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.replace(/\?.*$/, "").split("/").pop() ?? "";
  return url.length > 0 && /test/i.test(dbName);
}
