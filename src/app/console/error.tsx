"use client";

import { Alert, Button } from "@/components/ui";

/** 콘솔 공통 오류 경계 — DB 일시 장애 등이 Next 기본 오류 화면으로 새지 않게. 자세한 내용은 서버 로그에 */
export default function ConsoleError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 32, maxWidth: 560, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      <Alert kind="error">화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</Alert>
      <div className="actions">
        <Button type="button" variant="primary" onClick={() => reset()}>
          다시 시도
        </Button>
        <a href="/console" className="btn">
          콘솔 홈
        </a>
      </div>
    </main>
  );
}
