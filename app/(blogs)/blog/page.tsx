import Blogs2 from "@/components/blogs/Blogs2";
import Cta from "@/components/common/Cta";
import Footer2 from "@/components/footers/Footer2";
import { Metadata } from "next";
export const metadata: Metadata = {
  title:
    "Insights & Articles | Ascend Web Solutions",
  description:
    "Design, development, SEO, and performance insights from Ascend Web Solutions. Practical ideas to help businesses grow online.",
};
export default function BlogCreativePage() {
  return (
    <>
      <main
        id="mxd-page-content"
        className="mxd-page-content inner-page-content"
      >
        <Blogs2 />
        <Cta />
      </main>
      <Footer2 />
    </>
  );
}
