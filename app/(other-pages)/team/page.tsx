import Blogs from "@/components/common/Blogs";
import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";
import About from "@/components/other-pages/team/About";
import Hero from "@/components/other-pages/team/Hero";
import MarqueeSlider from "@/components/other-pages/team/MarqueeSlider";
import Teammembers from "@/components/other-pages/team/Teammembers";
import { Metadata } from "next";
export const metadata: Metadata = {
  title: "Our Team | Ascend Web Solutions",
  description:
    "Meet the team behind Ascend Web Solutions — Oscar Robles and Sergio Pena, helping businesses grow with modern web design and digital strategy.",
};
export default function TeamPage() {
  return (
    <>
      <main
        id="mxd-page-content"
        className="mxd-page-content inner-page-content"
      >
        <Hero />
        <MarqueeSlider />
        <Teammembers />
        <About />
        <Blogs />
        <Cta />
      </main>
      <Footer2 />
    </>
  );
}
