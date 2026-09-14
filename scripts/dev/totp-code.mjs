/**
 * 로컬 테스트용 TOTP 코드 생성기. 인증 앱 없이 ADMIN 2단계를 통과할 때 쓴다.
 *   node scripts/dev/totp-code.mjs <BASE32_SECRET>
 * 시크릿은 /login/totp 등록 화면이 보여주는 값이다. 프로덕션 계정에는 쓰지 말 것.
 */
import * as OTPAuth from "otpauth";

const secret = process.argv[2]?.replace(/\s+/g, "");
if (!secret) {
  console.error("사용법: node scripts/dev/totp-code.mjs <BASE32_SECRET>");
  process.exit(2);
}
const totp = new OTPAuth.TOTP({ issuer: "마주,봄", label: "local", algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
const left = 30 - Math.floor((Date.now() / 1000) % 30);
console.log(`${totp.generate()}   (${left}초 남음)`);
