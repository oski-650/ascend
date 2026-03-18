import { notFound } from "next/navigation";
import { Metadata } from "next";
import projectsData from "@/data/projects.json";

import DetailsHero from "@/components/portfolios/DetailsHero";
import ParallaxDivider2 from "@/components/portfolios/ParallaxDivider2";
import Challages from "@/components/portfolios/Challages";
import Solutions from "@/components/portfolios/Solutions";
import Feedback from "@/components/portfolios/Feedback";
import NextPrevNavigation from "@/components/portfolios/NextPrevNavigation";
import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return projectsData.projects1.map((project) => ({
    slug: project.pageLink.replace("/project-details/", ""),
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = projectsData.projects1.find(
    (p) => p.pageLink.replace("/project-details/", "") === slug
  );
  return {
    title: project
      ? `${project.title} || Ascend Web Solutions`
      : "Project || Ascend Web Solutions",
    description: project?.description ?? "Project details — Ascend Web Solutions",
  };
}

export default async function ProjectDetailsPage({ params }: PageProps) {
  const { slug } = await params;

  const project = projectsData.projects1.find(
    (p) => p.pageLink.replace("/project-details/", "") === slug
  );

  if (!project) {
    notFound();
  }

  return (
    <main key={slug}>
      {/* Hero / Project Title */}
      <DetailsHero project={project} />

      {/* Parallax Section */}
      <ParallaxDivider2 key={`parallax-${slug}`} src={project.parallax[0].src} projectKey={project.pageLink} />

      {/* Challenges Section */}
      <Challages key={`challenges-${slug}`} projectId={String(project.id)} />

      {/* Solution Section */}
      <Solutions key={`solutions-${slug}`} solution={project.solution} />

      {/* Feedback Section */}
      <Feedback feedbacks={project.feedback} />

      {/* Navigation */}
      <NextPrevNavigation
        currentProjectId={project.id}
        projects={projectsData.projects1}
      />

      {/* Call To Action */}
      <Cta />

      {/* Footer */}
      <Footer2 />
    </main>
  );
}
