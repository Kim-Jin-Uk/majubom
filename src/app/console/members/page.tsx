import { redirect } from "next/navigation";

/** 구성원 관리는 자원 콘솔(/console/resources)로 합쳤다 — 명세 화면 "/console/resources → 매니저 추가" */
export default function MembersPage() {
  redirect("/console/resources");
}
