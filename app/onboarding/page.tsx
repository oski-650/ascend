import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Start Your Project — Ascend Web Solutions",
  description:
    "Tell us about your business and your goals. We'll build a tailored project brief so we can hit the ground running.",
};

export default function OnboardingPage() {
  return (
    <main id="mxd-page-content" className="mxd-page-content ob-page">
      <OnboardingFlow />
    </main>
  );
}
