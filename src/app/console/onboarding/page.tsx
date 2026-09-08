import { redirect } from "next/navigation";
import { getPolicy, isPolicyTouched } from "@/features/business/policy";
import { getPublishStatus, wizardSteps } from "@/features/business/publish-gate";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { flags } from "@/lib/flags";

/** /console/onboarding → 아직 안 끝난 첫 필수 단계로. 필수가 다 끝났으면 1단계(검토) */
export default async function OnboardingIndex() {
  const v = await consoleViewer("/console/onboarding");
  const [status, policy] = await Promise.all([getPublishStatus(v.membership.businessId), getPolicy(v.membership.businessId)]);
  const steps = wizardSteps(status, { chatEnabled: flags.chat, policyTouched: isPolicyTouched(policy), brandTouched: false });
  const next = steps.find((s) => s.required && !s.done) ?? steps[0];
  redirect(`/console/onboarding/${next.n}`);
}
