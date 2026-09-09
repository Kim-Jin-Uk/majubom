import { randomInt } from "node:crypto";

/**
 * 고객 노출용 예약번호 (FR-BOOK-020 6단계). 8자리, 혼동 문자를 뺀 Base32.
 *
 * 전화로 불러 주는 번호라 헷갈리는 글자를 뺀다: 0·O, 1·I·L, U(V 와), 그리고 숫자 8·B 는 남기되 대문자만 쓴다.
 * 32^8 이 아니라 **26^8 ≈ 2×10^11** — 하루 몇만 건 규모에서 충돌 확률은 무시할 수준이고,
 * 그래도 `reservations.code` 가 unique 라 충돌하면 23505 가 나므로 호출자가 다시 뽑는다.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

export function newReservationCode(): string {
  let out = "";
  for (let i = 0; i < 8; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
