import BackgroundParallax from "@/components/animation/BackgroundParallax";
import Approch from "@/components/common/Approch";
import Awards from "@/components/common/Awards";
import Blogs from "@/components/common/Blogs";
import Cta from "@/components/common/Cta";
import Facts from "@/components/common/Facts";
import MarqueeSlider from "@/components/common/MarqueeSlider";
import Footer2 from "@/components/footers/Footer2";
import Hero2 from "@/components/other-pages/about/Hero2";
import MarqueeSlider2 from "@/components/other-pages/about/MarqueeSlider2";
import Team from "@/components/other-pages/about/Team";
import Techstack from "@/components/other-pages/about/Techstack";
import teamData from "@/data/team.json"; // make sure all team images are correct here
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Us || Ascend Web Solutions - Websites that Convert",
  description:
    "Ascend Web Solutions crafts websites that captivate, convert, and elevate brands. Learn about our team, tech expertise, and proven results.",
};

export default function AboutUsPage() {
  // Dynamically load parallax images
  const parallaxImages = [
    "/img/marquee/team-01.jpg",
    "/img/marquee/team-02.jpg",
  ];

  return (
    <>
      <main id="mxd-page-content" className="mxd-page-content inner-page-content">
        <Hero2 />
        <MarqueeSlider2 />

        {/* First Parallax */}
        <div className="mxd-section padding-pre-title">
          <div className="mxd-container">
            <div className="mxd-divider">
              <BackgroundParallax
                image={parallaxImages[0]}
                className="mxd-divider__image divider-image-8 parallax-img"
              />
            </div>
          </div>
        </div>

        {/* Team Section */}
        <Team /> {/* Pass team data dynamically */}

        <Techstack />
        <Facts />
        <Approch />

        {/* Second Parallax */}
        <div className="mxd-section padding-pre-title">
          <div className="mxd-container">
            <div className="mxd-divider">
              <BackgroundParallax
                image={parallaxImages[1]}
                className="mxd-divider__image divider-image-9 parallax-img"
              />
            </div>
          </div>
        </div>

        <Blogs />
        <Cta />
      </main>

      <Footer2 />
    </>
  );
}