import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { PublicHome } from "../public-home";
import { bookingHref } from "../routing";
import { SITE_THEME_KEY } from "../theme";
import { hourText } from "./hours";

/**
 * 시작 템플릿 (FR-SITE-010, #72·#73). 빌더(에픽 #15)가 오기 전까지 모든 공개 홈이 이 한 벌이다.
 * 서버 컴포넌트 — 상태가 없다. 사업장 데이터를 그대로 섹션으로 편다.
 *
 * 없는 것은 섹션째로 빠진다. 소개를 안 쓴 가게에 "소개" 라는 빈 제목만 남기면 미완성으로 보인다.
 */

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// 선택지는 `/` 로 잇는다 — 바깥 meta 줄이 `·` 로 이어져 있어서, 같은 기호를 쓰면
// "1시간 · 2시간 · 최대 4명" 에서 어디까지가 이용 시간 선택지인지 알 수 없다
const dur = (p: { durationMin: number; durationOptions: number[] | null }) =>
  p.durationOptions?.length ? `${p.durationOptions.map(mins).join(" / ")} 중 선택` : mins(p.durationMin);
const mins = (n: number) => (n % 60 === 0 ? `${n / 60}시간` : n > 60 ? `${Math.floor(n / 60)}시간 ${n % 60}분` : `${n}분`);
const dayLabel = (d: string) => {
  const [y, m, dd] = d.split("-").map(Number);
  return `${m}월 ${dd}일 (${DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`;
};

/** 요일별 영업시간을 같은 시간끼리 묶는다 — 일곱 줄을 그대로 늘어놓으면 아무도 안 읽는다 */
function groupHours(hours: PublicHome["openingHours"]) {
  const byDow = new Map(hours.map((h) => [h.dow, h]));
  const out: Array<{ days: number[]; text: string }> = [];
  for (let d = 0; d < 7; d++) {
    const h = byDow.get(d);
    const text = h ? hourText(h) : "휴무";
    const last = out[out.length - 1];
    if (last && last.text === text) last.days.push(d);
    else out.push({ days: [d], text });
  }
  return out.map((g) => ({ label: g.days.length === 1 ? DOW[g.days[0]] : `${DOW[g.days[0]]}–${DOW[g.days[g.days.length - 1]]}`, text: g.text }));
}

/** 예약할 수 있는 상품만 링크가 된다. 나머지는 같은 모양의 카드로 그대로 보여 준다 (메뉴판 노릇은 한다) */
function ProductCard({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link href={href} className="site-product-link">
      {children}
    </Link>
  ) : (
    <div className="site-product-link">{children}</div>
  );
}

export function PublicHomeView({ home }: { home: PublicHome }) {
  // 같은 사진이 여러 상품에 붙어 있을 수 있다. 커버로 쓴 것은 갤러리에서 뺀다 —
  // 안 그러면 사진 두 장짜리 가게에서 같은 사진이 커버·상품 썸네일·갤러리로 세 번 나온다
  const photos = [...new Set(home.products.flatMap((p) => p.images))];
  const cover = photos[0] ?? null;
  const gallery = photos.slice(1, 9);
  const hours = groupHours(home.openingHours);
  // 받을 사람이 없는 상품은 예약 링크를 걸지 않는다 — 위젯이 404 라 눌러도 없는 페이지에 도착한다
  const bookable = home.products.some((p) => p.bookable);
  const fullAddress = [home.address, home.addressDetail].filter(Boolean).join(" ");
  const tel = home.phone ? `tel:${home.phone.replace(/[^0-9+]/g, "")}` : null;
  const mapHref =
    home.lat !== null && home.lng !== null
      ? `https://map.kakao.com/link/map/${encodeURIComponent(home.name)},${home.lat},${home.lng}`
      : fullAddress
        ? `https://map.kakao.com/link/search/${encodeURIComponent(fullAddress)}`
        : null;

  return (
    <>
      {/*
        상호와 밝기 버튼이 스크롤을 따라온다 (#76·#77). `.site` 안에 두면 flex gap 이 사이에 끼므로
        본문 바깥에 둔다 — 본문(main)도 아니다. 커버 사진 위에 투명하게 띄우지 않는 이유는,
        사진이 밝으면 글자가 사라지기 때문. 자바스크립트 없이 sticky 하나로 끝난다
      */}
      <div className="site-top">
        <span className="site-top-name">{home.name}</span>
        {/* 사업자가 고른 밝기를 손님이 되돌릴 수 있는 자리 (#76 · 01 §10) */}
        <ThemeToggle size={34} storageKey={SITE_THEME_KEY} label="화면 밝기 바꾸기" />
      </div>

      <main className="site site--bar">
        <header className="site-cover">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL
            <img src={cover} alt="" className="site-cover-img" />
          ) : (
            <div className="site-cover-img site-cover-ph" />
          )}
          <div className="site-cover-body">
            <p className="site-cat">{home.category}</p>
            <h1>{home.name}</h1>
            {home.reviews.count > 0 && (
              <p className="site-rating">
                <b aria-hidden="true">★ {home.reviews.average?.toFixed(1)}</b>
                <span className="sr-only">5점 만점에 {home.reviews.average?.toFixed(1)}점, </span>
                <span>리뷰 {home.reviews.count}개</span>
              </p>
            )}
            {/* 넓은 화면에는 하단 바가 없다 — 예약 입구는 여기 하나로 늘 보인다 */}
            {bookable && (
              <Link href={bookingHref(home.slug)} className="btn btn--primary site-cta">
                예약하기
              </Link>
            )}
          </div>
        </header>

        <section className="site-sec">
          <h2>예약 상품</h2>
          <ul className="site-products">
            {home.products.map((p) => (
              <li key={p.id}>
                {/* 카드 전체가 예약 링크다 — 폰에서 작은 버튼을 겨냥하게 만들지 않는다 (#79) */}
                <ProductCard href={p.bookable ? bookingHref(home.slug, p.id) : null}>
                  {p.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL
                    <img src={p.images[0]} alt="" />
                  ) : (
                    <div className="ph" aria-hidden="true" />
                  )}
                  <div className="body">
                    <h3>{p.name}</h3>
                    <p className="meta">
                      {dur(p)}
                      {p.maxPartySize > 1 ? ` · 최대 ${p.maxPartySize}명` : ""}
                      {p.priceDisplay ? ` · ${p.priceDisplay}` : ""}
                    </p>
                    {p.description && <p className="desc">{p.description}</p>}
                  </div>
                  {p.bookable && (
                    <span className="go" aria-hidden="true">
                      ›
                    </span>
                  )}
                </ProductCard>
              </li>
            ))}
          </ul>
        </section>

        {home.description && (
          <section className="site-sec">
            <h2>소개</h2>
            <p className="site-desc">{home.description}</p>
          </section>
        )}

        {gallery.length > 0 && (
          <section className="site-sec">
            <h2>사진</h2>
            <div className="site-gallery">
              {gallery.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element -- 외부(R2) URL
                <img key={i} src={src} alt="" loading="lazy" />
              ))}
            </div>
          </section>
        )}

        {home.reviews.recent.length > 0 && (
          <section className="site-sec">
            <h2>리뷰</h2>
            <ul className="site-reviews">
              {home.reviews.recent.map((r) => (
                <li key={r.id}>
                  <p className="head">
                    <b aria-hidden="true">{"★".repeat(r.rating)}</b>
                    <span className="sr-only">5점 만점에 {r.rating}점.</span>
                    <span className="who">{r.author}</span>
                  </p>
                  <p>{r.content}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="site-sec">
          <h2>영업시간</h2>
          <dl className="site-hours">
            {hours.map((h) => (
              <div key={h.label}>
                <dt>{h.label}</dt>
                <dd className={h.text === "휴무" ? "muted" : undefined}>{h.text}</dd>
              </div>
            ))}
          </dl>
          {home.closedDays.length > 0 && (
            <>
              <h3 className="site-sub">휴무 안내</h3>
              <ul className="site-closed">
                {home.closedDays.map((c) => (
                  <li key={c.date}>
                    <b>{dayLabel(c.date)}</b>
                    {c.partial ? ` ${c.partial.start}–${c.partial.end} 휴무` : " 휴무"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {(fullAddress || home.phone) && (
          <section className="site-sec">
            <h2>찾아오시는 길</h2>
            {fullAddress && <p className="site-addr">{fullAddress}</p>}
            {tel && (
              <p>
                <a href={tel}>{home.phone}</a>
              </p>
            )}
            {/*
              지도는 **링크**다. `map.kakao.com/link/…` 은 카카오맵을 여는 주소지 임베드 엔드포인트가 아니라
              X-Frame-Options 로 프레임이 거부된다 — iframe 으로 넣으면 조용히 빈 상자가 남는다.
              제대로 심으려면 Maps JS SDK(appkey 필요)를 써야 하고, 그건 좌표 입력 UI(#12 주소 검색)와 함께 온다.
            */}
            {mapHref && (
              <p>
                <a href={mapHref} target="_blank" rel="noreferrer">
                  카카오맵에서 보기 →
                </a>
              </p>
            )}
          </section>
        )}

        <footer className="site-foot">
          <p>{home.name}</p>
        </footer>
      </main>

      {/*
        폰 전용 하단 바 (#77). 예약이 주인공이라 오른쪽에 크게 둔다 — 전화·길찾기는 있는 것만 나온다.
        넓은 화면에서는 본문에 같은 링크가 보여 숨긴다
      */}
      {(tel || mapHref || bookable) && (
        <div className="site-bar">
          {tel && (
            <a className="btn" href={tel}>
              전화
            </a>
          )}
          {mapHref && (
            <a className="btn" href={mapHref} target="_blank" rel="noreferrer">
              길찾기
            </a>
          )}
          {/* 위젯(#11)이 생겨서 이제 죽은 버튼이 아니다 */}
          {bookable && (
            <Link className="btn btn--primary bw-cta" href={bookingHref(home.slug)}>
              예약하기
            </Link>
          )}
        </div>
      )}
    </>
  );
}
