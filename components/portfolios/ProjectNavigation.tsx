"use client";

import Link from "next/link";
import AnimatedButton from "../animation/AnimatedButton";
import projectsJSON from "@/data/projects.json";

// Props for the navigation component
interface ProjectNavigationProps {
  currentProjectId: number;
}

// Only the fields needed for navigation
interface ProjectNavItem {
  id: number;
  title: string;
  pageLink: string;
}

// Match your JSON structure with 'projects1'
interface ProjectsJSON {
  projects1: ProjectNavItem[];
}

export default function ProjectNavigation({ currentProjectId }: ProjectNavigationProps) {
  // Cast the imported JSON to the correct type
  const projectsData = projectsJSON as ProjectsJSON;

  // Map to only the fields we need
  const projects: ProjectNavItem[] = projectsData.projects1.map((p) => ({
    id: p.id,
    title: p.title,
    pageLink: p.pageLink,
  }));

  const currentIndex = projects.findIndex((p) => p.id === currentProjectId);

  const prevProject = currentIndex > 0 ? projects[currentIndex - 1] : null;
  const nextProject = currentIndex < projects.length - 1 ? projects[currentIndex + 1] : null;

  // Nothing to show if there are no prev/next projects
  if (!prevProject && !nextProject) return null;

  return (
    <div className="mxd-article-navigation">
      <div className="container-fluid p-0">
        <div className="row g-0">
          {prevProject && (
            <div className="col-6 mxd-article-navigation__navitem left">
              <AnimatedButton
                className="btn btn-line-small btn-muted anim-no-delay slide-left"
                as="a"
                text="Prev"
                position="previous"
              >
                <i className="ph ph-arrow-left" />
              </AnimatedButton>
              <Link className="mxd-article-navigation__link" href={prevProject.pageLink}>
                <span>{prevProject.title}</span>
              </Link>
            </div>
          )}
          {nextProject && (
            <div className="col-6 mxd-article-navigation__navitem right">
              <AnimatedButton
                className="btn btn-line-small btn-muted anim-no-delay slide-right"
                as="a"
                text="Next"
                position="next"
              >
                <i className="ph ph-arrow-right" />
              </AnimatedButton>
              <Link className="mxd-article-navigation__link" href={nextProject.pageLink}>
                <span>{nextProject.title}</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}