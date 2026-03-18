#!/usr/bin/env node
/**
 * Usage:  node scripts/new-blog.mjs "Your Blog Post Title Here"
 *
 * Appends a skeleton entry to data/blogs.json (both `blogs` and `blogs1`).
 * Fill in the TODOs afterwards and add your thumbnail image.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const BLOGS_PATH = resolve(__dir, "../data/blogs.json");

/* ── helpers ── */

function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatDate(date) {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/* ── main ── */

const title = process.argv[2];
if (!title) {
  console.error('Usage: node scripts/new-blog.mjs "Your Blog Post Title"');
  process.exit(1);
}

const slug = toSlug(title);
const date = formatDate(new Date());
const data = JSON.parse(readFileSync(BLOGS_PATH, "utf8"));

// Check for duplicate slug
if (data.blogs.some((b) => b.slug === slug)) {
  console.error(`A blog with slug "${slug}" already exists.`);
  process.exit(1);
}

/* ── full article entry ── */
const newBlog = {
  slug,
  title,
  excerpt: "TODO: one or two sentence summary shown on the article page.",
  date,
  readTime: "TODO: e.g. 5 min. read",
  tags: ["TODO"],
  thumbnail: `/img/blog/article/${slug}.jpg`,
  chapters: [
    {
      id: "chapter-01",
      title: "Introduction",
      content: [
        "TODO: opening paragraph.",
        "TODO: second paragraph.",
      ],
    },
    {
      id: "chapter-02",
      title: "TODO: Chapter Title",
      content: [
        "TODO: paragraph.",
        "TODO: paragraph.",
      ],
    },
    {
      id: "chapter-03",
      title: "Conclusion",
      content: [
        "TODO: closing paragraph.",
      ],
    },
  ],
  author: {
    name: "Oscar Robles",
    position: "Web Strategist, Owner",
    avatar: "/img/team/oscar.jpg",
    quote: "TODO: best pull-quote from the article.",
    socials: [
      { platform: "LinkedIn", url: "https://www.linkedin.com/in/oscarrobles24" },
      { platform: "GitHub", url: "https://github.com/oski-650" },
    ],
  },
};

/* ── preview card entry ── */
const nextId = Math.max(...data.blogs1.map((b) => b.id), 0) + 1;
const imageClasses = ["blog-preview-image-1", "blog-preview-image-2", "blog-preview-image-3"];
const newCard = {
  id: nextId,
  slug,
  imageClass: imageClasses[(data.blogs1.length) % imageClasses.length],
  tags: ["TODO"],
  imgSrc: `/img/blog/article/${slug}.jpg`,
  title: {
    before: title,
    after: "",
  },
};

data.blogs.push(newBlog);
data.blogs1.push(newCard);

writeFileSync(BLOGS_PATH, JSON.stringify(data, null, 2));

console.log(`
✅  Blog created: "${title}"
    Slug: ${slug}

Next steps:
  1. Add thumbnail → public/img/blog/article/${slug}.jpg
  2. Fill in the TODOs in data/blogs.json
  3. Split the title in blogs1[].title into before/highlight/after if needed
`);
