import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";

import ScrollToTop from "@/components/common/ScrollToTop";
import MarqueeSlider from "@/components/portfolios/MarqueeSlider";
import PortfolioMasonry from "@/components/portfolios/PortfolioMasonry";
import Testimonials from "@/components/common/Testimonials";
import { Metadata } from "next";
export const metadata: Metadata = {
  title: "Selected Work | Ascend Web Solutions",
  description:
    "A curated selection of websites and digital projects built by Ascend — focused on clarity, performance, and real business results.",
};
export default function WorksMasonryPage() {
  return (
    <>
      <main
        id="mxd-page-content"
        className="mxd-page-content inner-page-content"
      >
        <ScrollToTop />
        <PortfolioMasonry />
        <MarqueeSlider />
        <Testimonials />
        <Cta />
      </main>
      <Footer2 />
    </>
  );
}
