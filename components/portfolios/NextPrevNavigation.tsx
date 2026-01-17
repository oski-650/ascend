import Link from "next/link";
import AnimatedButton from "../animation/AnimatedButton";
import projectsData from "../../data/projects.json";

// Use the actual type from JSON
type Project = typeof projectsData.projects1[number];

interface NextPrevNavigationProps {
  currentProjectId: number;
  projects: typeof projectsData.projects1;
}

export default function NextPrevNavigation({ currentProjectId, projects }: NextPrevNavigationProps) {

  // Find current index
  const currentIndex = projects.findIndex((p) => p.id === currentProjectId);

  // Compute previous and next safely
  const prevProject = currentIndex > 0 ? projects[currentIndex - 1] : null;
  const nextProject = currentIndex < projects.length - 1 ? projects[currentIndex + 1] : null;

  return (
    <div className="mxd-project__block no-margin">
      <div className="mxd-project__nav">
        <div className="mxd-project__divider anim-uni-in-up" />
        <div className="container-fluid p-0">
          <div className="row g-0">
            {prevProject && (
              <div className="col-6 mxd-project__navitem left mxd-grid-item no-margin anim-uni-in-up">
                <AnimatedButton
                  text="Prev"
                  className="btn btn-anim btn-line-small btn-muted anim-no-delay slide-left"
                  href={prevProject.pageLink}
                >
                  <i className="ph ph-arrow-left" />
                </AnimatedButton>
                <Link
                  className="mxd-project__link anim-uni-in-up"
                  href={prevProject.pageLink}
                >
                  <span>{prevProject.title}</span>
                </Link>
              </div>
            )}

            {nextProject && (
              <div className="col-6 mxd-project__navitem right mxd-grid-item no-margin anim-uni-in-up">
                <AnimatedButton
                  text="Next"
                  className="btn btn-anim btn-line-small btn-muted anim-no-delay slide-right"
                  href={nextProject.pageLink}
                >
                  <i className="ph ph-arrow-right" />
                </AnimatedButton>
                <Link
                  className="mxd-project__link anim-uni-in-up"
                  href={nextProject.pageLink}
                >
                  <span>{nextProject.title}</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}