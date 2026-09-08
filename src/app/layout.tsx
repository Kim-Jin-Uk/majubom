import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "마주,봄",
  description: "마주,봄 — 소규모 사업장 예약 서비스",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1411" },
  ],
};

/**
 * 첫 페인트 전에 localStorage `theme`("light" | "dark")를 <html data-theme>로 옮긴다.
 * 값이 없으면 data-theme 을 두지 않아 OS 설정(prefers-color-scheme)이 그대로 적용된다.
 * 서버는 data-theme 없이 렌더하므로 <html suppressHydrationWarning> 이 필요하다.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

// `LayoutProps<"/">` 는 .next/types 생성 후에만 존재하므로(clean checkout 의 typecheck 가 깨진다) 명시 타입을 쓴다
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* next/script beforeInteractive — 첫 페인트 전에 실행되고, React 가 클라이언트 렌더에서 <script> 를 만나 경고하지 않는다 */}
        <Script id="theme-init" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
