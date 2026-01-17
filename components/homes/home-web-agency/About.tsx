import AnimatedButton from "@/components/animation/AnimatedButton";
import RevealText from "@/components/animation/RevealText";
import Link from "next/link";

export default function About() {
  return (
    <div className="mxd-section padding-pre-pinned-img">
      <div className="mxd-container grid-container">
        {/* Block - About Description with Manifest Start */}
        <div className="mxd-block">
          <div className="container-fluid px-0">
            <div className="row gx-0 d-xl-flex justify-content-xl-center">
              <div className="col-12 col-xl-8 mxd-grid-item no-margin">
                <div className="mxd-block__content">
                  <div className="mxd-block__manifest">
                    <RevealText
                      as="p"
                      className="mxd-manifest mxd-manifest-l reveal-type"
                    >
                      We craft websites and digital experiences that help growing businesses succeed online. 
                      Thoughtfully designed and tailored for impact, our solutions help businesses stand out, 
                      reach their audience, and <span style={{ color: '#006B40' }}>Ascend</span> to new heights.
                    </RevealText>
                    <div className="mxd-manifest__controls">
                      <AnimatedButton
                        text="About Us"
                        className="btn btn-anim btn-default btn-outline slide-right-up anim-uni-in-up"
                        href={`/about-us`}
                      >
                        <i className="ph-bold ph-arrow-up-right" />
                      </AnimatedButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Block - About Description with Manifest End */}
      </div>
    </div>
  );
}
