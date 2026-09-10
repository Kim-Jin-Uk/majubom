import { redirect } from "next/navigation";
import { isPolicyTouched } from "@/features/business/policy";
import { loadConsoleBusiness, nextWizardStep, wizardSteps } from "@/features/business/publish-gate";
import { consoleViewer } from "@/features/business/ui/console-viewer";
import { flags } from "@/lib/flags";

/** /console/onboarding → 아직 안 끝난(그리고 지금 할 수 있는) 첫 필수 단계로. 없으면 1단계(검토) */
export default async function OnboardingIndex() {
  const v = await consoleViewer("/console/onboarding");
  const { status, policy, colorScheme } = await loadConsoleBusiness(v.membership.businessId);
  const steps = wizardSteps(status, { chatEnabled: flags.chat, policyTouched: isPolicyTouched(policy), brandTouched: colorScheme !== "AUTO" });
  redirect(`/console/onboarding/${(nextWizardStep(steps) ?? steps[0]).n}`);
}
