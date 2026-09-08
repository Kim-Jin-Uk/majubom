import Link from "next/link";
import { AuthShell, Button } from "@/components/ui";

/** 404. 프록시가 존재를 숨길 때(비관리자의 /admin)도 이 화면이 404 상태로 나간다 */
export default function NotFound() {
  return (
    <AuthShell>
      <h1>페이지를 찾을 수 없어요</h1>
      <p className="sub">주소가 바뀌었거나 없는 페이지입니다.</p>
      <Link href="/">
        <Button block>홈으로</Button>
      </Link>
    </AuthShell>
  );
}
