import Blogs from "@/components/common/Blogs";
import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";
import Hero from "@/components/other-pages/services/Hero";
import ParallaxDivider from "@/components/other-pages/services/ParallaxDivider";
import Services from "@/components/other-pages/services/Services";
import { Metadata } from "next";
export const metadata: Metadata = {
  title:
    "Services || Ascend Web Solutions",
  description:
    "Ascend Web Solutions offers professional website development, web design, and SEO solutions tailored for small businesses.",
};
export default function ServicesPage() {
  return (
    <>
      <main
        id="mxd-page-content"
        className="mxd-page-content inner-page-content"
      >
        <Hero />
        <Services />
        
        <Blogs />
        <Cta />
      </main>
      <Footer2 />
    </>
  );
}
