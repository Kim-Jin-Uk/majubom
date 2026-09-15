import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { loadBusinessReviews } from "@/features/review/reviews";
import { ConsoleReviewList } from "@/features/review/ui/ConsoleReviewList";

export const metadata = { title: "리뷰 — 마주,봄 콘솔" };

/** 사업자 답글 (FR-REV-020, #93). 매니저도 답글은 달 수 있다 — 손님 응대는 매장의 일상 업무다 */
export default async function ConsoleReviewsPage() {
  const v = await consoleViewer("/console/reviews");
  const rows = await loadBusinessReviews(v.membership.businessId);
  // 답글은 사장님이 매니저별로 끌 수 있는 권한이다 — 못 다는 사람에게 버튼을 보여 주지 않는다.
  // API 도 같은 검사를 한다(화면만 감추면 직접 호출이 남는다)
  const canReply = v.isOwner || v.membership.permissions.replyReview === true;
  return (
    <ConsoleShell current="reviews" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>리뷰</h1>
      <p className="sub" style={{ margin: "0 0 16px" }}>
        리뷰는 <b>지우거나 숨길 수 없습니다.</b> 사장님이 임의로 지울 수 있으면 리뷰를 믿을 이유가 없어져요 —
        부적절한 글은 가게 페이지에서 <b>신고</b>해 주시면 운영자가 확인합니다. 답글은 리뷰당 하나, 언제든 고칠 수 있어요.
      </p>
      {!canReply && <p className="sub">답글 권한이 없어 읽기만 하실 수 있어요. 필요하시면 사장님께 요청해 주세요.</p>}
      <ConsoleReviewList
        readOnly={v.readOnly || !canReply}
        initial={rows.map((r) => ({ ...r, at: r.at.toISOString(), reply: r.reply ? { content: r.reply.content, at: r.reply.at.toISOString() } : null }))}
      />
    </ConsoleShell>
  );
}
