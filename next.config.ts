import type { NextConfig } from "next";

// Files in /public are not content-hashed, so cache them for a week and
// revalidate in the background rather than marking them immutable.
// (Vercel's default for public files is max-age=0, which forces a
// revalidation round trip for every image, video and font on every visit.)
const STATIC_CACHE = "public, max-age=604800, stale-while-revalidate=86400";

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },
  async headers() {
    return ["/img/:path*", "/video/:path*", "/fonts/:path*"].map((source) => ({
      source,
      headers: [{ key: "Cache-Control", value: STATIC_CACHE }],
    }));
  },
};

export default nextConfig;
