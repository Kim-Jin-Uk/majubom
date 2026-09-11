import { describe, expect, it } from "vitest";
import {
  reservationCanceledByBizMail,
  reservationConfirmedMail,
  reservationExpiredMail,
  reservationRejectedMail,
  reservationRequestedMail,
  type ReservationMailInfo,
} from "./templates";

const INFO: ReservationMailInfo = {
  businessName: "마주봄 스튜디오",
  productName: "촬영 60분",
  when: "2026년 10월 5일 (월) 14:00 – 15:00",
  partySize: 2,
  code: "K3M7QP9A",
  url: "https://majubom.kr/@majubom-studio",
};
const ALL = [
  reservationRequestedMail("a@b.c", INFO),
  reservationConfirmedMail("a@b.c", INFO),
  reservationRejectedMail("a@b.c", INFO, "그날은 정기 휴무입니다"),
  reservationCanceledByBizMail("a@b.c", INFO, "설비 고장"),
  reservationExpiredMail("a@b.c", INFO),
];

describe("예약 메일", () => {
  it("다섯 통 모두 같은 정보 블록을 담는다 — 손님이 어느 예약 이야기인지 맞출 수 있어야 한다", () => {
    for (const m of ALL) {
      for (const s of [INFO.businessName, INFO.productName, INFO.when, INFO.code, INFO.url, "2명"]) {
        expect(m.text, m.subject).toContain(s);
      }
    }
  });

  it("제목만 보고도 결과를 안다 — 받은편지함에서 열지 않고 읽힌다", () => {
    expect(ALL.map((m) => m.subject)).toEqual([
      "[마주,봄] 예약이 접수되었습니다 — 마주봄 스튜디오",
      "[마주,봄] 예약이 확정되었습니다 — 마주봄 스튜디오",
      "[마주,봄] 예약이 거절되었습니다 — 마주봄 스튜디오",
      "[마주,봄] 예약이 취소되었습니다 — 마주봄 스튜디오",
      "[마주,봄] 예약 신청이 만료되었습니다 — 마주봄 스튜디오",
    ]);
  });

  it("접수는 확정이 아니라고 못박는다 — 이 한 줄이 없으면 손님이 그냥 간다", () => {
    expect(reservationRequestedMail("a@b.c", INFO).text).toContain("아직 확정은 아닙니다");
  });

  it("매장이 쓴 사유를 그대로 옮긴다", () => {
    expect(reservationRejectedMail("a@b.c", INFO, "그날은 정기 휴무입니다").text).toContain("그날은 정기 휴무입니다");
    expect(reservationCanceledByBizMail("a@b.c", INFO, "설비 고장").text).toContain("설비 고장");
  });

  it("사유가 없으면 빈 사유 줄을 만들지 않는다", () => {
    const m = reservationRejectedMail("a@b.c", INFO, "   ");
    expect(m.text).not.toContain("사유");
  });

  it("HTML 은 텍스트를 이스케이프한다 — 매장 사유가 그대로 마크업이 되면 안 된다", () => {
    const m = reservationRejectedMail("a@b.c", INFO, '<img src=x onerror="alert(1)">');
    expect(m.html).toContain("&lt;img");
    expect(m.html).not.toContain("<img");
  });

  it("링크는 절대 URL 이다 — 메일 클라이언트에는 기준 주소가 없다", () => {
    for (const m of ALL) expect(m.text).toMatch(/https:\/\/majubom\.kr\//);
  });

  it("확정 메일은 취소하는 법을 알려 준다 — 손님용 예약 상세 화면이 아직 없다 (#89)", () => {
    const m = reservationConfirmedMail("a@b.c", INFO);
    expect(m.text).toContain("매장으로 연락");
    expect(m.text, "없는 화면으로 보내지 않는다").not.toContain("/me/reservations");
  });
});
