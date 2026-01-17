import Blogs from "@/components/common/Blogs";
import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";

import About from "@/components/homes/home-web-agency/About";

import Hero from "@/components/homes/home-web-agency/Hero";
import MarqueeSlider from "@/components/homes/home-web-agency/MarqueeSlider";
import MarqueeSlider3 from "@/components/homes/home-web-agency/MarqueeSlider3";
import ParallaxBanner from "@/components/homes/home-web-agency/ParallaxBanner";
import Projects from "@/components/homes/home-web-agency/Projects";
import Services from "@/components/homes/home-web-agency/Services";
// import TechStack from "@/components/homes/home-web-agency/TechStack";
import { Metadata } from "next";
export const metadata: Metadata = {
  title:
    "Ascend Web Solutions || Innovative Web Design & Development",
  description:
    "Ascend Web Solutions is a leading web agency specializing in innovative web design, development, and digital marketing solutions to help businesses thrive online.",
};
export default function HomeWebAgencyPage() {
  return (
    <>
      <main id="mxd-page-content" className="mxd-page-content">
        <Hero />
        <MarqueeSlider />
        <ParallaxBanner />
        <About />
        <Services />
        <MarqueeSlider />
        <Projects />
        <MarqueeSlider3 />
        <Blogs />
        <Cta />
        {/* <TechStack /> */}
      </main>
      <Footer2 />
    </>
  );
}
