import Image from "next/image";
import RevealText from "../animation/RevealText";
import projectsData from "../../data/projects.json";

interface ChallengeImage {
  src: string;
}

interface Challenges {
  title: string;
  paragraphs: string[];
  images: ChallengeImage[];
}

interface Project {
  id: number;
  challenges: Challenges;
}

export default function Challages({ projectId }: { projectId: string }) {
  const project = (projectsData.projects1 as Project[]).find(
    (p) => String(p.id) === projectId
  );

  if (!project) return <p>Project not found</p>;

  const { challenges } = project;
  const imgs = challenges.images;

  return (
    <>
      {/* ================= TEXT BLOCK (UNCHANGED) ================= */}
      <div className="mxd-project__block pre-grid">
        <div className="container-fluid px-0">
          <div className="row gx-0">
            <div className="col-12 col-xl-5 mxd-grid-item no-margin">
              <div className="mxd-project__subtitle">
                <RevealText as="h2" className="reveal-type anim-uni-in-up">
                  {challenges.title}
                </RevealText>
              </div>
            </div>

            <div className="col-12 col-xl-6 mxd-grid-item no-margin">
              <div className="mxd-project__content">
                <div className="mxd-project__paragraph">
                  {challenges.paragraphs.map((para, i) => (
                    <p
                      key={i}
                      className={
                        i === 0
                          ? "t-large t-bright anim-uni-in-up"
                          : "anim-uni-in-up mt-3"
                      }
                    >
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= IMAGES BLOCK (STATIC LAYOUT, DYNAMIC SRC) ================= */}
      {/* overflow-hidden FIXES horizontal scroll from scale animations */}
      <div className="mxd-project__block no-margin overflow-hidden">
        <div className="mxd-project-cards overflow-hidden">
          <div className="container-fluid px-0">
            <div className="row gx-0">

              {/* IMAGE 1 */}
              <div className="col-12 col-xl-5 mxd-project-cards__item mxd-grid-item anim-uni-scale-in-right">
                <div className="mxd-project-cards__inner align-end bg-accent radius-m">
                  <Image
                    alt="Project Preview"
                    src={imgs[0]?.src}
                    width={1200}
                    height={1200}
                  />
                </div>
              </div>

              {/* IMAGE 2 */}
              <div className="col-12 col-xl-7 mxd-project-cards__item mxd-grid-item anim-uni-scale-in-left">
                <div className="mxd-project-cards__inner align-end bg-base-tint radius-m">
                  <Image
                    alt="Project Preview"
                    src={imgs[1]?.src}
                    width={1400}
                    height={1000}
                  />
                </div>
              </div>

              {/* IMAGE 3 */}
              <div className="col-12 col-xl-7 mxd-project-cards__item mxd-grid-item anim-uni-scale-in-right">
                <div className="mxd-project-cards__inner bg-base-tint radius-m">
                  <Image
                    alt="Project Preview"
                    src={imgs[2]?.src}
                    width={1400}
                    height={1000}
                  />
                </div>
              </div>

              {/* IMAGE 4 */}
              <div className="col-12 col-xl-5 mxd-project-cards__item mxd-grid-item anim-uni-scale-in-left">
                <div className="mxd-project-cards__inner bg-base-tint radius-m">
                  <Image
                    alt="Project Preview"
                    src={imgs[3]?.src}
                    width={1200}
                    height={1200}
                  />
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>
    </>
  );
}