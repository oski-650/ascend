import SimulationLab from "@/components/other-pages/ascend-engine/SimulationLab";
import Footer2 from "@/components/footers/Footer2";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Simulation Lab || Ascend Engine",
  description:
    "Watch the Ascend Engine think, classify, and book in real time. Live SMS simulations, process logs, and before/after route intelligence.",
};

interface Props {
  searchParams: Promise<{ preset?: string }>;
}

export default async function SimulationPage({ searchParams }: Props) {
  const { preset } = await searchParams;
  return (
    <>
      <main id="mxd-page-content" className="mxd-page-content ae-engine-page ae-sim-page">
        <SimulationLab preset={preset} />
      </main>
      <Footer2 />
    </>
  );
}
