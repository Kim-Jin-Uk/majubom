import { notFound } from "next/navigation";
import { getPolicy } from "@/features/business/policy";
import { getBusinessSettings } from "@/features/business/settings";
import { BusinessInfoForm } from "@/features/business/ui/BusinessInfoForm";
import { ConsoleShell } from "@/features/business/ui/ConsoleShell";
import { PolicyForm } from "@/features/business/ui/PolicyForm";
import { consoleViewer, publicBase } from "@/features/business/ui/console-viewer";

export const metadata = { title: "설정 — 마주,봄 콘솔" };

/** 사업장 설정 (FR-BIZ-010 · 020). OWNER 전용 — 매니저는 404 (존재를 노출하지 않는다, 08 §2) */
export default async function SettingsPage() {
  const v = await consoleViewer("/console/settings");
  if (!v.isOwner) notFound();
  const [b, policy] = await Promise.all([getBusinessSettings(v.membership.businessId), getPolicy(v.membership.businessId)]);
  return (
    <ConsoleShell current="settings" viewer={{ name: v.name, role: v.membership.role }}>
      <h1>설정</h1>
      <BusinessInfoForm initial={b} mode="settings" readOnly={v.readOnly} publicBase={publicBase()} />
      <PolicyForm initial={policy} mode="settings" readOnly={v.readOnly} />
    </ConsoleShell>
  );
}
