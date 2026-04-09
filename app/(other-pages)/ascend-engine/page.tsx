import Footer2 from "@/components/footers/Footer2";
import Hero from "@/components/other-pages/ascend-engine/Hero";
import PainPoints from "@/components/other-pages/ascend-engine/PainPoints";
import Architecture from "@/components/other-pages/ascend-engine/Architecture";
import IndustryPresets from "@/components/other-pages/ascend-engine/IndustryPresets";
import ROICalculator from "@/components/other-pages/ascend-engine/ROICalculator";
import EnginePageShell from "@/components/other-pages/ascend-engine/EnginePageShell";
import FinalCTA from "@/components/other-pages/ascend-engine/FinalCTA";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ascend Engine || Ascend Web Solutions",
  description:
    "Ascend Engine is the autonomous operating system for service pros — capturing leads, booking appointments, and following up 24/7 so you never miss a job.",
};

function AeNudge({ text }: { text: string }) {
  return (
    <div className="ae-nudge" aria-hidden="true">
      <span className="ae-nudge__line" />
      <span className="ae-nudge__text">{text}</span>
      <span className="ae-nudge__line" />
    </div>
  );
}

export default function AscendEnginePage() {
  return (
    <>
      <main id="mxd-page-content" className="mxd-page-content inner-page-content ae-engine-page">
        <EnginePageShell>
          <Hero />
          <AeNudge text="This is what's costing you — right now ↓" />
          <PainPoints />
          <AeNudge text="Here's exactly how the Engine closes every one of these gaps ↓" />
          <Architecture />
          <AeNudge text="Now see it working in your specific industry ↓" />
          <IndustryPresets />
          <AeNudge text="Find out the exact dollar amount you're leaving on the table ↓" />
          <ROICalculator />
          <FinalCTA />
        </EnginePageShell>
      </main>
      <Footer2 />
    </>
  );
}
