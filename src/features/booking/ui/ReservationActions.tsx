"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { apiPatch, describeError } from "@/lib/client-api";

/**
 * 예약 상세의 손 대는 부분 (FR-BOOK-090, #89). 나머지(정보·이력)는 서버 컴포넌트가 그린다 —
 * 상태를 가진 것만 클라이언트로 내려보낸다.
 *
 * **취소 여부는 서버가 판정해 내려준 것을 그대로 쓴다**(`customerCancelState`). 화면이 다시 계산하면
 * 버튼은 살아 있는데 누르면 409 가 나거나, 될 수 있는 취소를 화면이 먼저 막는다.
 */
export function ReservationActions({
  id,
  cancel,
  changeHref,
}: {
  id: string;
  cancel: { can: boolean; blocked: "STATUS" | "DEADLINE" | null; deadlineLabel: string | null };
  /** 시간 변경 진입 — 위젯이 `replaces` 를 달고 받는다. 취소가 막힌 뒤에는 변경도 막힌다 */
  changeHref: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function doCancel() {
    setBusy(true);
    const r = await apiPatch(`/api/me/reservations/${id}/cancel`, {});
    setBusy(false);
    if (!r.ok) {
      // 마감이 그 사이에 지났을 수 있다 — 서버 답이 최종이다
      setErr(r.error === "CANCEL_DEADLINE_PASSED" ? "취소 마감이 지났어요. 매장으로 연락해 주세요." : describeError(r));
      setAsking(false);
      return;
    }
    setAsking(false);
    router.refresh();
  }

  return (
    <>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="actions" style={{ marginTop: 16, flexWrap: "wrap" }}>
        {/* 캘린더는 파일을 내려받는 링크다 — 버튼으로 감싸면 접근성만 잃는다 */}
        <a className="btn" href={`/api/me/reservations/${id}/ics`}>
          캘린더에 담기
        </a>
        {changeHref && (
          <a className="btn" href={changeHref}>
            시간 변경
          </a>
        )}
        {cancel.can &&
          (asking ? (
            <>
              {/* 취소는 되돌릴 수 없다 — 자리가 바로 풀려서 같은 시각을 다시 잡는다는 보장이 없다 */}
              <span className="sub">정말 취소할까요? 같은 시각이 다시 비어 있다는 보장은 없어요.</span>
              <Button type="button" variant="danger" loading={busy} onClick={() => void doCancel()}>
                예약 취소
              </Button>
              <Button type="button" onClick={() => setAsking(false)} disabled={busy}>
                그대로 두기
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setAsking(true)}>
              예약 취소
            </Button>
          ))}
      </div>
      {!cancel.can && cancel.blocked === "DEADLINE" && (
        <p className="sub">
          취소 마감({cancel.deadlineLabel})이 지나 여기서는 취소할 수 없어요. 매장으로 연락해 주세요 — 예약번호를 알려 주시면 됩니다.
        </p>
      )}
    </>
  );
}
