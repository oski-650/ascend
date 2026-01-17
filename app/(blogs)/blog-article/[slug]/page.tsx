import Header1 from "@/components/headers/Header1";
import Footer2 from "@/components/footers/Footer2";
import BlogDetails from "@/components/blogs/BlogDetails";
import Blogs from "@/components/common/Blogs";
import Cta from "@/components/common/Cta";
import blogsData from "@/data/blogs.json";
import { notFound } from "next/navigation";
import { Metadata } from "next";

/* ================= METADATA ================= */
export const metadata: Metadata = {
  title: "Blog Details || Ascend Web Solutions",
  description:
    "Insights, tips, and case studies from Ascend Web Solutions — helping businesses grow digitally with modern web design and SEO.",
};

/* ================= PAGE ================= */
type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function BlogSinglePage({ params }: PageProps) {
  // Await params (App Router dynamic route)
  const { slug } = await params;

  // Find the blog in blogs.json
  const blog = blogsData.blogs.find((b) => b.slug === slug);

  // If not found, show 404
  if (!blog) {
    notFound();
  }

  return (
    <>
      {/* Header always visible */}
      <Header1 />

      <main
        id="mxd-page-content"
        className="mxd-page-content inner-page-content"
      >
        {/* Blog content */}
        <BlogDetails 
        blog={blog} />

        {/* Related blogs */}
        <Blogs title="More on topic" desc="" />

        {/* Call to action */}
        <Cta />
      </main>

      {/* Footer */}
      <Footer2 />
    </>
  );
}