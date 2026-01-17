import RevealText from "../animation/RevealText";
import BackgroundParallax from "../animation/BackgroundParallax";

interface SolutionProps {
  solution: {
    title: string;
    paragraphs: string[];
    parallaxImage?: {
      src: string;
    };
  };
}

export default function Solutions({ solution }: SolutionProps) {
  return (
    <>
      {/* Project Block - Solution Description */}
      <div className="mxd-project__block">
        <div className="container-fluid px-0">
          <div className="row gx-0">
            <div className="col-12 col-xl-5 mxd-grid-item no-margin">
              <div className="mxd-project__subtitle">
                <RevealText as="h2" className="reveal-type anim-uni-in-up">
                  {solution.title}
                </RevealText>
              </div>
            </div>

            <div className="col-12 col-xl-6 mxd-grid-item no-margin">
              <div className="mxd-project__content">
                <div className="mxd-project__paragraph medium-text">
                  {solution.paragraphs.map((para, i) => (
                    <p key={i} className="anim-uni-in-up">
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Project Block - Parallax Image */}
      {solution.parallaxImage && (
        <div className="mxd-project__block mxd-grid-item no-margin">
          <div className="mxd-divider">
            <BackgroundParallax
              image={solution.parallaxImage.src} // ✅ ONLY dynamic part
              scale={1.5} // ✅ static
              className="mxd-divider__image" // ✅ static
            />
          </div>
        </div>
      )}
    </>
  );
}