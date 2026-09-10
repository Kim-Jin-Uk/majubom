import type { Mail } from "./index";

/**
 * 메일 템플릿 — 전부 텍스트 우선. HTML 은 같은 내용의 최소 마크업만 (스팸 점수·접근성).
 * 링크는 절대 URL 이어야 한다 (AUTH_URL 기준). 제목에 "[마주,봄]" 접두.
 */
const BRAND = "마주,봄";

function wrap(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>");
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.6;color:#222">${body}</div>`;
}

function mail(to: string, subject: string, text: string): Mail {
  return { to, subject: `[${BRAND}] ${subject}`, text, html: wrap(text) };
}

/** FR-AUTH-010 사업자 가입 이메일 OTP */
export function businessOtpMail(to: string, code: string, minutes: number): Mail {
  return mail(
    to,
    "사업자 가입 인증번호",
    `${BRAND} 사업자 가입 인증번호입니다.\n\n${code}\n\n${minutes}분 안에 입력해 주세요. 본인이 요청한 것이 아니면 이 메일을 무시하세요.`,
  );
}

/** FR-AUTH-010 접수 확인 */
export function businessAppliedMail(to: string, businessName: string, consoleUrl: string): Mail {
  return mail(
    to,
    `${businessName} 가입 신청이 접수되었습니다`,
    `${businessName} 의 ${BRAND} 가입 신청이 접수되었습니다.\n\n심사는 보통 1영업일 안에 끝납니다. 기다리는 동안에도 콘솔에서 매장·자원·상품·홈페이지를 모두 준비할 수 있습니다 — 승인되면 예약 페이지가 바로 공개됩니다.\n\n콘솔: ${consoleUrl}`,
  );
}

/** FR-AUTH-030 고객 이메일 검증 링크 (비동기) */
export function emailVerifyMail(to: string, url: string, hours: number): Mail {
  return mail(
    to,
    "이메일 주소를 확인해 주세요",
    `아래 링크를 열면 이메일 확인이 끝납니다.\n\n${url}\n\n링크는 ${hours}시간 동안 유효합니다. 확인 전에도 예약은 정상적으로 이용할 수 있습니다.`,
  );
}

/** FR-AUTH-020 매니저 초대 */
export function inviteMail(to: string, businessName: string, inviterName: string, url: string, hours: number): Mail {
  return mail(
    to,
    `${businessName} 매니저로 초대되었습니다`,
    `${inviterName} 님이 ${businessName} 의 매니저로 초대했습니다.\n\n아래 링크에서 비밀번호를 설정하면 바로 시작할 수 있습니다.\n\n${url}\n\n링크는 ${hours}시간 동안 한 번만 쓸 수 있습니다. 만료되면 사업자에게 재발송을 요청하세요.`,
  );
}

/** FR-AUTH-040 비밀번호 재설정 */
export function passwordResetMail(to: string, url: string, minutes: number): Mail {
  return mail(
    to,
    "비밀번호 재설정",
    `비밀번호 재설정을 요청하셨습니다.\n\n${url}\n\n링크는 ${minutes}분 동안 한 번만 쓸 수 있습니다. 본인이 요청한 것이 아니면 이 메일을 무시하세요 — 비밀번호는 바뀌지 않습니다.`,
  );
}

/** FR-AUTH-040 소셜 전용 계정에 재설정을 요청한 경우 */
export function passwordResetSocialOnlyMail(to: string, provider: "KAKAO" | "GOOGLE", loginUrl: string): Mail {
  const name = provider === "KAKAO" ? "카카오" : "구글";
  return mail(
    to,
    "비밀번호 재설정",
    `이 계정은 ${name} 로그인으로 만들어져 비밀번호가 없습니다.\n\n${name}로 로그인해 주세요: ${loginUrl}\n\n본인이 요청한 것이 아니면 이 메일을 무시하세요.`,
  );
}

/**
 * 예약 메일 (FR-NOTI-010 · #57 최소본).
 *
 * 알림 체계(에픽 #14 — `Notification` 적재 · 채널 선택 · 재시도 · 수신 설정)가 오기 전까지,
 * **손님이 결과를 알 수 없으면 안 되는 것**만 즉시 메일로 보낸다. 매장 쪽 알림(담당 매니저 웹푸시·인앱)은
 * 그 에픽의 몫이라 여기 없다.
 *
 * 다섯 통 모두 같은 정보 블록을 쓴다 — 손님이 여러 통을 받았을 때 어느 예약 이야기인지 한눈에 맞춰야 한다.
 */
export type ReservationMailInfo = {
  businessName: string;
  productName: string;
  /** `2026년 10월 5일 (월) 14:00 – 15:00` — 화면과 같은 규칙 (`booking/notify-text.ts`) */
  when: string;
  partySize: number;
  code: string;
  /** 절대 URL. 예약 상세 */
  url: string;
};

function block(i: ReservationMailInfo): string {
  return [`· 매장: ${i.businessName}`, `· 상품: ${i.productName}`, `· 일시: ${i.when}`, `· 인원: ${i.partySize}명`, `· 예약번호: ${i.code}`].join("\n");
}

/** 사유는 매장이 쓴 그대로 옮긴다. 없으면 줄 자체를 빼서 "사유: (없음)" 같은 빈칸을 만들지 않는다 */
function because(reason?: string | null): string {
  const r = reason?.trim();
  return r ? `\n\n매장이 남긴 사유:\n${r}` : "";
}

/** 접수 — 매장 승인을 기다리는 상태 (autoConfirm 이 아닌 상품) */
export function reservationRequestedMail(to: string, i: ReservationMailInfo): Mail {
  return mail(
    to,
    `예약이 접수되었습니다 — ${i.businessName}`,
    `예약 신청이 접수되었습니다. 아직 확정은 아닙니다 — 매장이 확인하면 확정 메일을 다시 보내 드립니다.\n\n${block(i)}\n\n예약 확인: ${i.url}`,
  );
}

/** 확정 — 손님이 실제로 가도 되는 상태 */
export function reservationConfirmedMail(to: string, i: ReservationMailInfo): Mail {
  return mail(to, `예약이 확정되었습니다 — ${i.businessName}`, `예약이 확정되었습니다.\n\n${block(i)}\n\n예약 확인·취소: ${i.url}`);
}

/** 거절 — 매장이 받지 않기로 한 것. 취소와 구분한다 */
export function reservationRejectedMail(to: string, i: ReservationMailInfo, reason?: string | null): Mail {
  return mail(
    to,
    `예약이 거절되었습니다 — ${i.businessName}`,
    `아쉽게도 매장이 이 예약을 받지 못했습니다.${because(reason)}\n\n${block(i)}\n\n다른 시간으로 다시 예약하실 수 있습니다: ${i.url}`,
  );
}

/** 매장 취소 — 이미 확정됐던 예약이 매장 사정으로 취소된 것. 손님에게는 가장 나쁜 소식이라 제목부터 분명히 */
export function reservationCanceledByBizMail(to: string, i: ReservationMailInfo, reason?: string | null): Mail {
  return mail(
    to,
    `예약이 취소되었습니다 — ${i.businessName}`,
    `매장 사정으로 예약이 취소되었습니다.${because(reason)}\n\n${block(i)}\n\n다른 시간으로 다시 예약하실 수 있습니다: ${i.url}`,
  );
}

/**
 * 승인 대기 만료 — 매장이 정해진 시간 안에 확인하지 않아 자동으로 끝난 것.
 * 이 메일이 없으면 손님은 "접수됨" 에서 소식이 끊긴 채 그날 가게 앞에 선다.
 */
export function reservationExpiredMail(to: string, i: ReservationMailInfo): Mail {
  return mail(
    to,
    `예약 신청이 만료되었습니다 — ${i.businessName}`,
    `매장이 확인하지 못해 예약 신청이 자동으로 만료되었습니다. 이 시간은 다시 열려 있습니다.\n\n${block(i)}\n\n다시 예약하기: ${i.url}`,
  );
}
