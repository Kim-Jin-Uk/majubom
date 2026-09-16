import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { publicHomeHref } from "../routing";
import { SITE_THEME_KEY } from "../theme";

/**
 * 가게 페이지 공통 머리 — "마주,봄 / 가게" 빵부스러기와 밝기 버튼 (#190 · #76).
 *
 * 홈에만 있던 것을 꺼냈다. 리뷰 목록(#93)처럼 `/@{slug}` 아래 새 화면이 생길 때마다 같은 머리를
 * 다시 그리면 언젠가 하나가 달라진다 — 검색으로 들어온 손님이 **여기가 마주,봄이라는 걸** 알아야
 * 다른 가게도 찾아볼 수 있고, 길을 잃었을 때 돌아갈 곳이 있어야 한다.
 */
export function SiteTopBar({ slug, name }: { slug: string; name: string }) {
  return (
    <div className="site-top">
      <nav className="site-top-crumb" aria-label="위치">
        <Link href="/" className="site-top-brand" aria-label="마주,봄 홈">
          <Logo size={18} />
        </Link>
        <span className="site-top-sep" aria-hidden="true">
          /
        </span>
        <Link href={publicHomeHref(slug)} className="site-top-name">
          {name}
        </Link>
      </nav>
      <ThemeToggle size={34} storageKey={SITE_THEME_KEY} label="화면 밝기 바꾸기" />
    </div>
  );
}
