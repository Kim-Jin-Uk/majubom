import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { bookingSelections, products } from "@/db/schema";
import { HttpError } from "@/features/auth/errors";
import type { RequestMeta } from "@/lib/request-meta";
import { loadBookingWidget } from "./data";

/**
 * 서버측 임시 선택 토큰 (FR-AUTH-030 · FR-SITE-020 [6], #83).
 *
 * 로그인 왕복에서 선택을 살려 두기 위한 것이다. `sessionStorage` 는 같은 탭에서만 유효한데
 * 카카오 로그인은 앱으로 나갔다 오고, 소셜이 이메일을 안 주면 검증 링크가 다른 탭에서 열린다.
 *
 * **자리를 잡아 두지 않는다.** 복원한 뒤에도 그 시각은 예약 생성이 다시 검증한다(`create.ts` 3단계) —
 * 토큰이 슬롯을 묶으면 로그인하다 만 손님들이 남의 자리를 30분씩 점거한다.
 */
export const SELECTION_TTL_MIN = 30;

/**
 * 로그인 없이 쓸 수 있는 유일한 쓰기 경로다. IP 를 알 수 없으면(헤더 위조·프록시 없음) "알 수 없음" 버킷으로
 * 같이 세어 fail-closed — 건너뛰면 헤더 한 줄로 상한이 사라진다 (사업자 가입의 IP 쿼터와 같은 수법).
 * 상한을 넉넉히 잡은 이유: 한 손님이 시간·담당자를 바꿔 가며 확인 화면을 여러 번 열 수 있고, 회사·학교는 NAT 뒤라 IP 를 공유한다.
 */
export const SELECTIONS_PER_IP_PER_HOUR = 60;

async function assertIpQuota(ip: string | null): Promise<void> {
  const since = new Date(Date.now() - 3600_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookingSelections)
    .where(and(ip ? eq(bookingSelections.ip, ip) : isNull(bookingSelections.ip), gt(bookingSelections.createdAt, since)));
  if (n >= SELECTIONS_PER_IP_PER_HOUR) throw new HttpError(429, "RATE_LIMITED", { retryAfterSec: 600 });
}

export const selectionSchema = z.object({
  productId: z.uuid(),
  startAt: z.string().min(1),
  /** 그 시각이 속한 영업일. 순간에서 되짚을 수 없다 (자정 넘김 영업) */
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
  partySize: z.number().int().min(1).max(500),
  durationMin: z.number().int().positive().optional().nullable(),
  resourceId: z.uuid().optional().nullable(),
  customerNote: z.string().trim().max(500, "요청사항은 500자 이내").optional().nullable(),
});
export type SelectionInput = z.output<typeof selectionSchema>;
export type StoredSelection = SelectionInput & { slug: string };

/**
 * 만든다. 공개 홈이 열려 있는 사업장의 **예약 가능한** 상품이어야 한다 — 게이트는 위젯과 같은 것을 쓴다.
 * 그러지 않으면 정지된 가게의 상품으로 토큰을 만들어 두고 복원 화면을 열 수 있다.
 */
export async function createSelection(input: SelectionInput, meta: RequestMeta): Promise<{ id: string }> {
  await assertIpQuota(meta.ip);
  const [p] = await db.select({ businessId: products.businessId }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!p) throw new HttpError(404, "NOT_FOUND");
  const widget = await loadBookingWidget(p.businessId);
  const product = widget?.products.find((x) => x.id === input.productId);
  if (!widget || !product) throw new HttpError(404, "NOT_FOUND");
  // 남의 가게 자원 id 를 실어 보내면 여기서 끊는다. AUTO·NONE 은 자원 목록이 비어 있으므로 값 자체를 버린다
  const resourceId = input.resourceId && product.resources.some((r) => r.id === input.resourceId) ? input.resourceId : null;

  const startAt = new Date(input.startAt);
  if (Number.isNaN(startAt.getTime())) throw new HttpError(400, "INVALID_BODY", { issues: [{ path: ["startAt"], message: "시각 형식이 아닙니다" }] });

  const [row] = await db
    .insert(bookingSelections)
    .values({
      businessId: p.businessId,
      productId: input.productId,
      startAt,
      businessDate: input.businessDate,
      partySize: input.partySize,
      durationMin: input.durationMin ?? null,
      resourceId,
      customerNote: input.customerNote?.trim() || null,
      ip: meta.ip,
      expiresAt: sql`now() + interval '${sql.raw(String(SELECTION_TTL_MIN))} minutes'`,
    })
    .returning({ id: bookingSelections.id });
  return { id: row.id };
}

/**
 * 읽는다. 만료됐거나, 그 사이 가게가 닫혔거나 상품이 내려갔으면 **없는 것과 같다** —
 * 복원해 봐야 그다음 단계에서 막히고, 손님은 왜 막히는지 모른 채 서 있게 된다.
 */
export async function loadSelection(id: string): Promise<StoredSelection | null> {
  const [row] = await db
    .select({
      businessId: bookingSelections.businessId,
      productId: bookingSelections.productId,
      startAt: bookingSelections.startAt,
      businessDate: bookingSelections.businessDate,
      partySize: bookingSelections.partySize,
      durationMin: bookingSelections.durationMin,
      resourceId: bookingSelections.resourceId,
      customerNote: bookingSelections.customerNote,
    })
    .from(bookingSelections)
    .where(and(eq(bookingSelections.id, id), gt(bookingSelections.expiresAt, sql`now()`)))
    .limit(1);
  if (!row) return null;
  const widget = await loadBookingWidget(row.businessId);
  const product = widget?.products.find((x) => x.id === row.productId);
  if (!widget || !product) return null;
  return {
    slug: widget.slug,
    productId: row.productId,
    startAt: row.startAt.toISOString(),
    businessDate: row.businessDate,
    partySize: row.partySize,
    durationMin: row.durationMin,
    // 그 사이 자원이 비활성이 됐으면 "상관없음" 으로 되돌린다 — 없는 담당자를 고른 채로 확인 화면에 서 있지 않게
    resourceId: row.resourceId && product.resources.some((r) => r.id === row.resourceId) ? row.resourceId : null,
    customerNote: row.customerNote,
  };
}

/** 만료분 정리. 정리 배치(`/api/cron/cleanup-unverified`)가 하루 한 번 부른다 */
export async function purgeExpiredSelections(): Promise<number> {
  // returning() 을 쓰지 않는다 — 지운 행을 전부 실어 올 이유가 없다
  const r = await db.delete(bookingSelections).where(lt(bookingSelections.expiresAt, sql`now()`));
  return r.rowCount ?? 0;
}
