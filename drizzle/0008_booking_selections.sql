-- 0008_booking_selections — 예약 위젯의 서버측 임시 선택 토큰 (FR-AUTH-030 · FR-SITE-020 [6], #83).
-- 로그인 직전의 선택을 sessionStorage 에 두면 같은 탭에서만 살아남는다. 카카오 로그인은 앱으로 나갔다 오고
-- 이메일 검증 링크는 다른 탭에서 열려, 그때마다 복원이 깨진다. 30분 TTL, 만료분은 정리 배치가 지운다.
-- 로그인 전에 만들어지므로 사용자에 묶이지 않는다 — 담는 것은 손님이 직접 고른 값과 발급 IP(상한용)뿐이다.
-- business_date 를 따로 담는 이유: 자정을 넘긴 영업일의 새벽 시각은 달력 날짜와 다르다.
CREATE TABLE "booking_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"business_date" date NOT NULL,
	"party_size" integer NOT NULL,
	"duration_min" integer,
	"resource_id" uuid,
	"customer_note" text,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_selections" ADD CONSTRAINT "booking_selections_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_selections" ADD CONSTRAINT "booking_selections_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_selections" ADD CONSTRAINT "booking_selections_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_selections_expires_idx" ON "booking_selections" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "booking_selections_ip_created_idx" ON "booking_selections" USING btree ("ip","created_at");