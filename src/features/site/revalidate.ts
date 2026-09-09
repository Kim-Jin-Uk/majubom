import { revalidatePath } from "next/cache";
import { publicHomePath } from "./public-home";

/**
 * 공개 홈이 보여 주는 것이 바뀌었을 때 그 경로를 무효화한다 (FR-SITE-010 "발행·수정 시 명시적 무효화").
 *
 * 이것이 지우는 것은 **Next 의 캐시뿐**이다. 실제로 손님에게 가는 응답은 CDN 이 최대 60초 들고 있으므로
 * 상호를 고친 직후 새로고침해도 한동안 옛 화면이 보일 수 있다 — CDN 무효화 API 는 2기(에픽 #20)에서 붙인다.
 * 그래도 이걸 부르는 이유는, 부르지 않으면 그 인스턴스가 **60초가 아니라 다음 요청까지** 옛 값을 들고 있기 때문이다.
 *
 * 실패해도 호출자의 작업을 되돌리지 않는다. 캐시가 조금 늦는 것과 저장이 실패하는 것은 무게가 다르다.
 */
export async function revalidatePublicHome(businessId: string): Promise<void> {
  const path = await publicHomePath(businessId).catch(() => null);
  if (path) revalidateSitePath(path);
}

/** 경로를 이미 아는 경우 (주소를 바꾸면 **옛 경로**도 지워야 한다 — 거기 남은 것은 이제 301 이 나가야 할 자리다) */
export function revalidateSitePath(path: string): void {
  try {
    revalidatePath(path);
  } catch (e) {
    console.error("[site] revalidate 실패:", (e as Error).message);
  }
}
