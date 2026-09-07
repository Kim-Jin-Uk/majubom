import type { MetadataRoute } from "next";
import { gateEnabled } from "@/lib/env";

// 요청 시점의 GATE_ENABLED 를 반영하도록 정적 생성하지 않는다
export const dynamic = "force-dynamic";

/**
 * 1기(고객 없음) 동안은 전부 막는다 (08 §3.1). 미완성 페이지가 색인되면
 * 정식 오픈 때 품질 신호가 깎인다. proxy.ts 의 X-Robots-Tag 와 한 쌍이다.
 */
export default function robots(): MetadataRoute.Robots {
  if (gateEnabled()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return { rules: { userAgent: "*", allow: "/" } };
}
