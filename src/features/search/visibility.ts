import { sql } from "drizzle-orm";

/**
 * "이 사업장을 손님이 볼 수 있는가" 를 **SQL 로** 쓴 판정.
 *
 * 정본은 `site/public-home.ts` 의 게이트다 — 거기서는 사업장 하나를 읽어 TS 로 판정한다(`isInfoComplete`).
 * 검색은 여러 사업장을 훑어 자르므로 그 판정이 WHERE 절에 있어야 한다. **같은 규칙의 두 번째 표현**이라
 * 어긋나면 검색이 비공개 사업장을 흘린다 — `tests/db/search.test.ts` 가 둘이 같은 답을 내는지 본다.
 *
 * 조건(순서는 `loadPublicHome` 과 같다):
 *   승인됨 · 사업자가 내리지 않음 · 정보 완성(상호·전화·주소·영업시간 1일+·정식 slug) · 받을 자원 1개+
 *
 * `businesses` 별칭을 그대로 쓰므로 `businesses` 를 FROM 에 둔 쿼리에서만 붙인다.
 */
export const businessIsPublic = sql`
  businesses.status = 'APPROVED'
  and coalesce((select sp.is_published from site_pages sp where sp.business_id = businesses.id limit 1), true)
  and coalesce(nullif(btrim(businesses.name), ''), null) is not null
  and coalesce(nullif(btrim(businesses.phone), ''), null) is not null
  and coalesce(nullif(btrim(businesses.address), ''), null) is not null
  and jsonb_array_length(businesses.opening_hours) > 0
  and businesses.slug not like 'b-%'
  and exists (select 1 from resources r where r.business_id = businesses.id and r.is_active)
`;

/**
 * 그 상품을 지금 예약할 수 있는가. 공개 홈의 상품 목록과 같은 조건이다 —
 * `ACTIVE` 이고 **받을 자원이 하나라도 살아 있어야** 한다(`bookable`). 자원이 전부 비활성이면
 * 카드를 눌러도 슬롯이 하나도 안 나오므로 검색 결과에 둘 이유가 없다.
 */
export const productIsBookable = sql`
  products.status = 'ACTIVE'
  and exists (
    select 1 from product_resources pr
    join resources r2 on r2.id = pr.resource_id
    where pr.product_id = products.id and r2.is_active
  )
`;
