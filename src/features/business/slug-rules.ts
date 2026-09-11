import { z } from "zod";

/**
 * 공개 주소(`/@{slug}`) 규칙 — **서버·클라이언트 공용**(DB 를 끌어오지 않는다).
 * 라우트의 검증과 설정 화면의 안내가 같은 규칙을 본다. 화면에 규칙을 한 벌 더 적으면
 * 둘이 어긋나는 날 "버튼은 눌리는데 서버가 거절하는" 자리가 생긴다.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{3,30}$/, "영소문자·숫자·하이픈 3~30자")
  .refine((s) => !s.startsWith("-") && !s.endsWith("-"), "하이픈으로 시작하거나 끝날 수 없습니다")
  .refine((s) => !s.startsWith("b-"), "b- 로 시작하는 주소는 임시 주소용입니다");

/** 예약어 — 공개 URL /@{slug} 와 충돌하거나 오해를 부르는 것 */
export const RESERVED_SLUGS = new Set(["admin", "console", "api", "login", "signup", "me", "majubom", "help", "about", "www", "app", "static", "_next", "support", "terms", "privacy", "notice", "official", "assets", "sitemap", "invite", "reset-password", "forgot-password"]);

/** 가입 때 자동으로 붙는 임시 주소인가. 임시인 동안에는 공개 홈이 열리지 않는다 (`isInfoComplete`) */
export function isTempSlug(slug: string): boolean {
  return slug.startsWith("b-");
}

/**
 * 입력한 주소를 저장할 수 있는지와, **못 한다면 왜인지**.
 *
 * 버튼을 조용히 끄기만 하면 왜 눌리지 않는지 알 방법이 없다 — 실제로 임시 주소를 그대로 다시 적고
 * "저장이 안 된다" 로 막힌 적이 있다. 막는 자리마다 문장을 하나씩 돌려준다.
 */
export function checkSlugInput(input: string, savedSlug: string): { canSave: boolean; reason: string | null } {
  const s = input.trim().toLowerCase();
  if (!s) return { canSave: false, reason: null }; // 빈 칸은 아직 입력 전 — 나무라지 않는다
  if (s === savedSlug) {
    return { canSave: false, reason: isTempSlug(s) ? "지금 쓰는 임시 주소예요. 다른 주소를 정해 주세요" : "지금 쓰는 주소예요" };
  }
  if (isTempSlug(s)) return { canSave: false, reason: "b- 로 시작하는 주소는 임시 주소 전용이라 쓸 수 없어요" };
  if (RESERVED_SLUGS.has(s)) return { canSave: false, reason: "이미 예약된 주소예요" };
  const parsed = slugSchema.safeParse(s);
  if (!parsed.success) return { canSave: false, reason: parsed.error.issues[0]?.message ?? "주소 형식을 확인해 주세요" };
  return { canSave: true, reason: null };
}
