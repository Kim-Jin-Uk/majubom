import { NextResponse } from "next/server";
import type { MemberPermissions } from "@/db/schema";
import { auth } from "./auth";
import { HttpError, pgCode } from "./errors";
import type { Membership, Principal } from "./principal";

export { HttpError };

/**
 * 라우트·서버 컴포넌트용 가드. 프록시가 이미 (1) 세션 갱신 (2) 콘솔 상태 재확인 (3) ADMIN mfa 를 처리했으므로
 * 여기서는 JWT 스냅샷을 읽어 **스코프**(사업장 · 권한)만 판정한다. DB 를 다시 치지 않는다.
 *
 * 규칙 (08 §2 · 보안): 타 사업장 리소스는 403 이 아니라 **404** — 존재를 노출하지 않는다. 미인증은 401.
 */
export type Viewer = { uid: string; sid: string | null; principal: Principal; mfa: "ok" | "pending" };

/** 로그인한 사용자 (가입 미완 pending 은 제외). 없으면 401 */
export async function requireUser(): Promise<Viewer> {
  const s = await auth();
  if (!s || !s.principal || !s.user.id) throw new HttpError(401, "UNAUTHENTICATED");
  return { uid: s.user.id, sid: s.sid, principal: s.principal, mfa: s.mfa };
}

export async function optionalUser(): Promise<Viewer | null> {
  const s = await auth();
  if (!s || !s.principal || !s.user.id) return null;
  return { uid: s.user.id, sid: s.sid, principal: s.principal, mfa: s.mfa };
}

export type ConsoleViewer = Viewer & { membership: Membership };

/**
 * 콘솔 API: 소속 멤버여야 하고, businessId 를 받았다면 자기 사업장이어야 한다 (아니면 404).
 * 권한 키를 주면 OWNER 는 항상 통과, MANAGER 는 permissions[key] 가 true 여야 한다 (아니면 403).
 */
export async function requireConsole(opts: { businessId?: string; permission?: keyof MemberPermissions } = {}): Promise<ConsoleViewer> {
  const v = await requireUser();
  const m = v.principal.membership;
  if (!m || m.memberStatus !== "ACTIVE") throw new HttpError(403, "NO_MEMBERSHIP");
  if (m.businessStatus === "BLOCKED") throw new HttpError(403, "BUSINESS_BLOCKED");
  if (opts.businessId && opts.businessId !== m.businessId) throw new HttpError(404, "NOT_FOUND");
  if (opts.permission && m.role !== "OWNER" && !m.permissions[opts.permission]) throw new HttpError(403, "FORBIDDEN", { permission: opts.permission });
  return { ...v, membership: m };
}

export async function requireOwner(opts: { businessId?: string } = {}): Promise<ConsoleViewer> {
  const v = await requireConsole(opts);
  if (v.membership.role !== "OWNER") throw new HttpError(403, "OWNER_ONLY");
  return v;
}

/**
 * SUSPENDED 사업장은 읽기 전용 (FR-ADM-020). 프록시가 `x-majubom-readonly: 1` 로 알려준다.
 * 예외(예약 취소·고객 상담)는 해당 라우트가 이 검사를 부르지 않는 것으로 표현한다.
 */
export function assertWritable(req: Request): void {
  if (req.headers.get("x-majubom-readonly") === "1") throw new HttpError(403, "READ_ONLY", { reason: "BUSINESS_SUSPENDED" });
}

/** ADMIN + TOTP 통과. 프록시가 /admin·/api/admin 에서 이미 막지만, 다른 경로에서 쓰는 관리자 액션을 위해 여기서도 검사 */
export async function requireAdmin(): Promise<Viewer> {
  const v = await requireUser();
  if (v.principal.globalRole !== "ADMIN") throw new HttpError(404, "NOT_FOUND");
  if (v.mfa !== "ok") throw new HttpError(403, "MFA_REQUIRED");
  return v;
}

/** 라우트 핸들러 공통 래퍼: HttpError → JSON, 그 외 → 500 (메시지는 숨긴다) */
export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) return e.toResponse();
      // unique 위반(동시 가입 등 read-then-write 경합)은 서버 오류가 아니라 충돌이다 — 정합성은 제약이 지켰다
      if (pgCode(e) === "23505") return new HttpError(409, "CONFLICT").toResponse();
      // FK 위반(참조 중인 행 삭제 등)도 충돌 — 제약 이름은 내부 구조라 응답에 싣지 않는다
      if (pgCode(e) === "23503") return new HttpError(409, "IN_USE").toResponse();
      console.error(`[api] ${req.method} ${new URL(req.url).pathname}:`, e);
      return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
    }
  };
}
