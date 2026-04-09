import RevealText from "@/components/animation/RevealText";
import AnimatedButton from "@/components/animation/AnimatedButton";
import engineData from "@/data/ascend-engine.json";

const { teaser, benefits } = engineData;

export default function AscendEngine() {
  return (
    <div className="mxd-section ae-section">
      <div className="mxd-container grid-container">
        <div className="mxd-block">
          <div className="container-fluid px-0">
            <div className="row gx-0">

              {/* Left — Label, Headline, Stat, CTA */}
              <div className="col-12 col-xl-5 mxd-grid-item no-margin">
                <div className="ae-section__left">

                  {/* Label */}
                  <p className="mxd-point-subtitle ae-label anim-uni-in-up">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      x="0px"
                      y="0px"
                      width="20px"
                      height="20px"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill="currentColor"
                        d="M19.6,9.6c0,0-3,0-4,0c-0.4,0-1.8-0.2-1.8-0.2c-0.6-0.1-1.1-0.2-1.6-0.6c-0.5-0.3-0.9-0.8-1.2-1.2
                    c-0.3-0.4-0.4-0.9-0.5-1.4c0,0-0.1-1.1-0.2-1.5c-0.1-1.1,0-4.4,0-4.4C10.4,0.2,10.2,0,10,0S9.6,0.2,9.6,0.4c0,0,0.1,3.3,0,4.4
                    c0,0.4-0.2,1.5-0.2,1.5C9.4,6.7,9.2,7.2,9,7.6C8.7,8.1,8.2,8.5,7.8,8.9c-0.5,0.3-1,0.5-1.6,0.6c0,0-1.2,0.1-1.7,0.2
                    c-1,0.1-4.2,0-4.2,0C0.2,9.6,0,9.8,0,10c0,0.2,0.2,0.4,0.4,0.4c0,0,3.1-0.1,4.2,0c0.4,0,1.7,0.2,1.7,0.2c0.6,0.1,1.1,0.2,1.6,0.6
                    c0.4,0.3,0.8,0.7,1.1,1.1c0.3,0.5,0.5,1,0.6,1.6c0,0,0.1,1.3,0.2,1.7c0,1,0,4.1,0,4.1c0,0.2,0.2,0.4,0.4,0.4s0.4-0.2,0.4-0.4
                    c0,0,0-3.1,0-4.1c0-0.4,0.2-1.7,0.2-1.7c0.1-0.6,0.2-1.1,0.6-1.6c0.3-0.4,0.7-0.8,1.1-1.1c0.5-0.3,1-0.5,1.6-0.6
                    c0,0,1.3-0.1,1.8-0.2c1,0,4,0,4,0c0.2,0,0.4-0.2,0.4-0.4C20,9.8,19.8,9.6,19.6,9.6L19.6,9.6z"
                      />
                    </svg>
                    <span>{teaser.label}</span>
                  </p>

                  {/* Headline */}
                  <RevealText
                    as="h2"
                    className="ae-section__headline reveal-type"
                    scrub={false}
                    stagger={0.03}
                    start="top 85%"
                  >
                    {teaser.headline}
                  </RevealText>

                  {/* Stat callout */}
                  <div className="ae-section__stat anim-uni-in-up">
                    <p>
                      Service businesses using Ascend Engine recover up to{" "}
                      <span className="ae-stat-highlight">$10,000/month</span>{" "}
                      in leads that would have gone cold.
                    </p>
                  </div>

                  {/* CTA */}
                  <div className="anim-uni-in-up ae-section__cta">
                    <AnimatedButton
                      text={teaser.cta.text}
                      className="btn btn-anim btn-default btn-additional slide-right-up"
                      href={teaser.cta.href}
                    >
                      <i className="ph-bold ph-arrow-up-right" />
                    </AnimatedButton>
                  </div>

                </div>
              </div>

              {/* Right — Intro + Benefits */}
              <div className="col-12 col-xl-7 mxd-grid-item no-margin">
                <div className="ae-section__right">

                  {/* Intro */}
                  <p className="ae-section__intro anim-uni-in-up">
                    Most websites just sit there.{" "}
                    <strong className="ae-stat-highlight">Ascend Engine</strong> works{" "}
                    <strong style={{ color: "#fff", fontWeight: 700 }}>24/7</strong> to capture leads, book appointments,
                    and follow up with customers — so you can stay on the job site.
                  </p>

                  {/* Benefits */}
                  <div className="ae-benefits">
                    {benefits.map((benefit, i) => (
                      <div key={i} className="ae-benefit anim-uni-in-up">
                        <div className="ae-benefit__icon">
                          <i className={`ph-bold ${benefit.icon}`} />
                        </div>
                        <div className="ae-benefit__body">
                          <h6 className="ae-benefit__title">{benefit.title}</h6>
                          <p className="ae-benefit__descr">{benefit.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
