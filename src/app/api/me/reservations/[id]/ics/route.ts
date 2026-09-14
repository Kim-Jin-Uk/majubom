import { handle, requireUser } from "@/features/auth/guards";
import { buildIcs } from "@/features/booking/ics";
import { loadMyReservationDetail } from "@/features/booking/my-reservations";
import { HttpError } from "@/features/auth/errors";
import { uuidParam } from "@/lib/api";

/**
 * GET /api/me/reservations/:id/ics — 캘린더 담기 (FR-BOOK-090, #89).
 *
 * 파일 하나를 내려 주는 것으로 끝낸다. 구글·애플 캘린더 연동(OAuth)을 붙이면 계정 권한을 받아야 하고,
 * 손님이 예약 하나 달력에 넣으려고 캘린더 전체 쓰기 권한을 주는 건 과하다. `.ics` 는 세 앱 다 연다.
 *
 * **남의 예약은 404.** 조회 계층이 본인 것만 찾으므로 여기서 따로 판정하지 않는다.
 */
export const GET = handle(async (_req, ctx) => {
  const v = await requireUser();
  const id = uuidParam((await ctx.params).id);
  const r = await loadMyReservationDetail(v.uid, id);
  if (!r) throw new HttpError(404, "NOT_FOUND");

  const body = buildIcs({
    // 같은 예약을 두 번 담아도 캘린더가 **같은 일정으로 알아보게** 예약번호를 UID 로 쓴다.
    // 임의 값이면 누를 때마다 일정이 하나씩 늘어난다
    uid: `${r.code}@majubom.kr`,
    start: Date.parse(r.startInstant),
    end: Date.parse(r.endInstant),
    stamp: Date.now(),
    summary: `${r.businessName} · ${r.productName}`,
    location: r.businessAddress,
    description: [`예약번호 ${r.code}`, r.staffName ? `담당 ${r.staffName}` : null, r.businessPhone].filter(Boolean).join("\n"),
  });

  return new Response(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="majubom-${r.code}.ics"`,
      // 예약이 바뀌면 파일도 달라져야 한다 — 캐시에 걸리면 옛 시각이 달력에 들어간다
      "cache-control": "no-store",
    },
  });
});
