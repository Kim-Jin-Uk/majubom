import { eq } from "drizzle-orm";
import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Kakao from "next-auth/providers/kakao";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requestMeta, type RequestMeta } from "@/lib/request-meta";
import { ACCESS_TTL_SEC, COOKIE_SESSION, REFRESH_TTL_SEC } from "./constants";
import { refreshCookie } from "./cookies";
import { hashPassword, passwordNeedsRehash, verifyPassword, verifyServerProof } from "./crypto";
import { loginBackoff, recordLoginFail } from "./login-backoff";
import { readIdentity, resolveOAuthUser } from "./oauth-account";
import { loadPrincipal, userLoginDenial, type Principal } from "./principal";
import { createSession, revokeSession } from "./session-store";
import "./types";
import { emailSchema } from "./validation";

/**
 * Auth.js v5 (FR-AUTH-030). 설계 요약 — 자세한 건 src/features/auth/README.md.
 *
 * - 세션 전략 jwt. 쿠키 `majubom.session` = 암호화 JWT = **액세스 스냅샷**(uid · principal · accessExp 15분).
 * - 리프레시 토큰은 Auth.js 밖에 있다: sessions 테이블 + 쿠키 `majubom.refresh`. 갱신·회전은 **프록시**(src/proxy.ts →
 *   refresh.ts) 가 매 요청 수행한다. Auth.js 의 jwt 콜백은 RSC 에서 쿠키를 못 쓰므로(next-auth 가 Set-Cookie 를 버린다)
 *   거기서 회전하면 클라이언트 토큰이 어긋난다 — jwt 콜백은 **로그인 시점과 update 트리거에서만** DB 를 만진다.
 * - 프로바이더: Credentials(이메일) · Google · Kakao. 소셜은 env 가 있을 때만 켠다 (#12 카카오 앱 등록 전).
 */

/** 로그인 실패 코드 — URL 에 노출되므로 계정 존재 여부를 암시하지 않는다 */
export class LoginError extends CredentialsSignin {
  constructor(
    public code: "invalid" | "locked" | "inactive",
    public retryAfterSec = 0,
  ) {
    super(code);
  }
}

const CredentialsBody = z.object({ email: emailSchema, password: z.string().min(1).max(128) });

const isProd = process.env.NODE_ENV === "production";

function providers(): NextAuthConfig["providers"] {
  const list: NextAuthConfig["providers"] = [
    Credentials({
      id: "credentials",
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = CredentialsBody.safeParse(raw);
        if (!parsed.success) throw new LoginError("invalid");
        const { email, password } = parsed.data;
        const meta = requestMeta(request.headers);

        const backoff = await loginBackoff(email);
        if (backoff.blocked) {
          await recordLoginFail(email, meta, "BACKOFF");
          throw new LoginError("locked", backoff.retryAfterSec);
        }

        const [u] = await db
          .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash, status: users.status, provider: users.provider })
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        // 사용자가 없어도 비밀번호 검증을 한 번 돌려 응답 시간을 맞춘다 (열거 방지)
        const ok = await verifyPassword(password, u?.passwordHash);
        if (!u || !ok) {
          await recordLoginFail(email, meta, !u ? "NO_USER" : u.passwordHash ? "BAD_PASSWORD" : "SOCIAL_ONLY");
          throw new LoginError("invalid");
        }
        if (userLoginDenial({ userStatus: u.status })) {
          await recordLoginFail(email, meta, "INACTIVE");
          throw new LoginError("inactive");
        }
        if (u.passwordHash && passwordNeedsRehash(u.passwordHash)) {
          await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, u.id));
        }
        return { id: u.id, name: u.name, email: u.email };
      },
    }),
  ];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    list.push(Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET, allowDangerousEmailAccountLinking: false }));
  }
  if (process.env.AUTH_KAKAO_ID && process.env.AUTH_KAKAO_SECRET) {
    list.push(Kakao({ clientId: process.env.AUTH_KAKAO_ID, clientSecret: process.env.AUTH_KAKAO_SECRET, allowDangerousEmailAccountLinking: false }));
  }
  return list;
}

/** 어떤 소셜 버튼을 보여줄지 — 로그인 화면이 쓴다 */
export function enabledSocialProviders(): Array<"google" | "kakao"> {
  const out: Array<"google" | "kakao"> = [];
  if (process.env.AUTH_KAKAO_ID && process.env.AUTH_KAKAO_SECRET) out.push("kakao");
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) out.push("google");
  return out;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** 로그인 확정: sessions 행 생성 + 리프레시 쿠키 + JWT 필드. Route Handler 컨텍스트에서만 호출된다 (cookies().set 가능) */
async function establish(token: Record<string, unknown>, principal: Principal, meta: RequestMeta) {
  const rt = await createSession(principal.uid, meta);
  const c = refreshCookie(rt);
  (await cookies()).set(c.name, c.value, c.options);
  token.uid = principal.uid;
  token.sid = rt.sid;
  token.accessExp = nowSec() + ACCESS_TTL_SEC;
  token.p = principal;
  token.mfa = principal.globalRole === "ADMIN" ? "pending" : "ok";
  token.name = principal.name;
  delete token.pending;
  delete token.email; // 쿠키에 이메일을 두지 않는다
  delete token.picture;
}

async function currentMeta(): Promise<RequestMeta> {
  // jwt 콜백에는 request 가 오지 않는다. Route Handler 컨텍스트라 next/headers 를 쓸 수 있다.
  const { headers } = await import("next/headers");
  return requestMeta(await headers());
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  providers: providers(),
  session: { strategy: "jwt", maxAge: REFRESH_TTL_SEC },
  pages: { signIn: "/login", error: "/login" },
  cookies: {
    sessionToken: { name: COOKIE_SESSION, options: { httpOnly: true, sameSite: "lax", secure: isProd, path: "/" } },
  },
  callbacks: {
    async signIn({ account, profile }) {
      if (!account || account.provider === "credentials") return true;
      const id = readIdentity(account, profile);
      if (!id) return false;
      // 이메일이 겹치는데 제공자가 검증을 보증하지 않으면 여기서 거절한다 (jwt 콜백은 리다이렉트를 못 한다)
      const r = await resolveOAuthUser(id);
      if (r.kind === "denied") return `/login?error=${r.code}`;
      return true;
    },

    async jwt({ token, user, account, profile, trigger, session }) {
      // ── 로그인 시점 ────────────────────────────────────────────────
      if (account) {
        const meta = await currentMeta();
        if (account.provider === "credentials") {
          const p = user?.id ? await loadPrincipal(user.id) : null;
          if (!p) return null;
          await establish(token, p, meta);
          return token;
        }
        const id = readIdentity(account, profile);
        if (!id) return null;
        const r = await resolveOAuthUser(id);
        if (r.kind === "denied") return null;
        if (r.kind === "pending") {
          token.pending = r.pending;
          token.name = r.pending.name;
          delete token.email;
          delete token.picture;
          return token;
        }
        const p = await loadPrincipal(r.uid);
        if (!p || userLoginDenial(p)) return null;
        await establish(token, p, meta);
        return token;
      }

      // ── /signup/complete 가 가입을 끝낸 뒤 unstable_update({ bindUid }) 로 세션을 확립한다 ──
      if (trigger === "update" && session && typeof session === "object" && "bindUid" in session && token.pending && !token.uid) {
        const uid = String((session as { bindUid: unknown }).bindUid);
        const [u] = await db
          .select({ id: users.id, provider: users.provider, providerAccountId: users.providerAccountId })
          .from(users)
          .where(eq(users.id, uid))
          .limit(1);
        if (!u || u.provider !== token.pending.provider || u.providerAccountId !== token.pending.providerAccountId) return token;
        const p = await loadPrincipal(uid);
        if (!p || userLoginDenial(p)) return null;
        await establish(token, p, await currentMeta());
        return token;
      }

      // ── ADMIN TOTP 통과: /api/auth/totp/verify 가 unstable_update({ mfaProof }) 로 올린다 ──
      // 세션 update 엔드포인트는 클라이언트도 호출할 수 있으므로 본문을 믿지 않는다 — 서버만 만들 수 있는 HMAC 증명을 검사한다.
      if (trigger === "update" && session && typeof session === "object" && "mfaProof" in session && token.uid && token.sid) {
        if (verifyServerProof((session as { mfaProof: unknown }).mfaProof, "mfa", token.sid, process.env.AUTH_SECRET ?? "")) token.mfa = "ok";
        return token;
      }

      // 그 외(RSC·라우트에서의 auth()): 아무것도 바꾸지 않는다. 갱신·회전은 프록시(refresh.ts)가 한다.
      return token;
    },

    async session({ session, token }) {
      session.user = { id: token.uid ?? "", name: (token.name as string | null) ?? "" } as typeof session.user;
      session.principal = token.p ?? null;
      session.mfa = token.mfa ?? "pending";
      session.pending = token.pending ?? null;
      session.accessExp = token.accessExp ?? null;
      session.sid = token.sid ?? null;
      return session;
    },
  },
  events: {
    async signOut(message) {
      // jwt 전략에서는 { token } 이 온다. 리프레시 행을 폐기한다.
      // 리프레시 쿠키는 여기서 지우지 않는다: 이 핸들러 안에서 cookies().set 을 부르면 Next 가 Auth.js 의 Set-Cookie 를
      // 다시 파싱하면서 `Max-Age=0` 을 떨어뜨려(falsy 압축) 세션 쿠키 삭제가 무효가 된다. 세션 쿠키 없이 남은 리프레시
      // 쿠키는 프록시(refresh.ts)가 다음 요청에서 지운다.
      const token = "token" in message ? message.token : null;
      if (token?.sid) await revokeSession(token.sid);
    },
  },
};

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth(authConfig);
