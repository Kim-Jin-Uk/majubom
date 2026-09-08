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
