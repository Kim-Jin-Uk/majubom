import { NextResponse } from "next/server";
import { handle, requireConsole } from "@/features/auth/guards";
import { getPublishStatus } from "@/features/business/publish-gate";

/** GET /api/console/publish-status — 홈페이지 공개 조건 충족 여부 (FR-BIZ-030). 위저드 패널·콘솔 홈이 폴링 없이 로드 시 1회 조회 */
export const GET = handle(async () => {
  const v = await requireConsole();
  return NextResponse.json(await getPublishStatus(v.membership.businessId));
});
