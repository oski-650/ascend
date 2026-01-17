import Image from "next/image";
import Link from "next/link";
import Comments from "./Comments";
import AnimatedButton from "../animation/AnimatedButton";

/* ================= TYPES ================= */

export type Blog = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  readTime: string;
  tags: string[];
  thumbnail: string;
  chapters: {
    id: string;
    title: string;
    content: string[];
  }[];
  author: {
    name: string;
    position: string;
    avatar: string;
    quote: string;
    socials: {
      platform: string;
      url: string;
    }[];
  };
};

type BlogDetailsProps = {
  blog: Blog;
};

/* ================= COMPONENT ================= */

export default function BlogDetails({ blog }: BlogDetailsProps) {
  return (
    <div className="mxd-section padding-pre-title">
      <div className="mxd-container grid-container">
        <div className="mxd-article-area">
          <div className="mxd-article-container mxd-grid-item no-margin">
            <article className="mxd-article">

              {/* ===== HEADLINE ===== */}
              <div className="mxd-article__headline">
                <div className="mxd-article__meta">
                  <div className="mxd-article__breadcrumbs">
                    <span><Link href="/">Home</Link></span>
                    <span><Link href="/blog">Insights</Link></span>
                    <span className="current-item">{blog.title}</span>
                  </div>

                  <div className="mxd-article__data">
                    <span className="meta-date">
                      {blog.date}
                      {/* SVG divider */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        aria-hidden="true"
                      >
                        <path d="M19.6,9.6h-3.9c-.4,0-1.8-.2-1.8-.2-.6,0-1.1-.2-1.6-.6-.5-.3-.9-.8-1.2-1.2-.3-.4-.4-.9-.5-1.4,0,0,0-1.1-.2-1.5V.4c0-.2-.2-.4-.4-.4s-.4.2-.4.4v4.4c0,.4-.2,1.5-.2,1.5,0,.5-.2,1-.5,1.4-.3.5-.7.9-1.2,1.2s-1,.5-1.6.6c0,0-1.2,0-1.7.2H.4c-.2,0-.4.2-.4.4s.2.4.4.4h4.1c.4,0,1.7.2,1.7.2.6,0,1.1.2,1.6.6.4.3.8.7,1.1,1.1.3.5.5,1,.6,1.6,0,0,0,1.3.2,1.7v4.1c0,.2.2.4.4.4s.4-.2.4-.4v-4.1c0-.4.2-1.7.2-1.7,0-.6.2-1.1.6-1.6.3-.4.7-.8,1.1-1.1.5-.3,1-.5,1.6-.6,0,0,1.3,0,1.8-.2h3.9c.2,0,.4-.2.4-.4s-.2-.4-.4-.4Z" />
                      </svg>
                    </span>

                    <span className="meta-time">{blog.readTime}</span>
                  </div>
                </div>

                <div className="mxd-article__title">
                  <h1 className="h1-small">{blog.title}</h1>
                </div>

                <div className="mxd-article__tags">
                  {blog.tags.map((tag) => (
                    <span
                      key={tag}
                      className="tag tag-default tag-outline tag-link-outline"
                    >
                      <Link href="/blog">{tag}</Link>
                    </span>
                  ))}
                </div>
              </div>

              {/* ===== THUMBNAIL ===== */}
              <div className="mxd-article__thumb">
                <Image
                  alt={blog.title}
                  src={blog.thumbnail}
                  width={1920}
                  height={1280}
                  priority
                />
              </div>

              {/* ===== CONTENT ===== */}
              <div className="mxd-article__content">

                <div className="mxd-article__block">
                  <p className="t-large mxd-article__excerpt">
                    {blog.excerpt}
                  </p>
                </div>

                {/* Table of contents */}
                <div className="mxd-article__block block-table-of-contents">
                  <p className="table-of-contents__title">Table of contents:</p>
                  <ul className="table-of-contents__nav">
                    {blog.chapters.map((chapter) => (
                      <li key={chapter.id}>
                        <a href={`#${chapter.id}`}>{chapter.title}</a>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Chapters */}
                {blog.chapters.map((chapter) => (
                  <div
                    key={chapter.id}
                    id={chapter.id}
                    className="mxd-article__block"
                  >
                    <h3>{chapter.title}</h3>
                    {chapter.content.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                ))}
              </div>
            </article>

            {/* ===== AUTHOR ===== */}
            <div className="mxd-article-author">
              <div className="mxd-article-author__data">
                <a
                  className="mxd-article-author_avatar"
                  href="#"
                >
                  <Image
                    alt={blog.author.name}
                    src={blog.author.avatar}
                    width={300}
                    height={300}
                  />
                </a>

                <div className="mxd-article-author__info">
                  <h5 className="mxd-article-author__name">
                    {blog.author.name}
                    <small className="mxd-article-author__position">
                      {blog.author.position}
                    </small>
                  </h5>

                  <div className="mxd-article-author__socials">
                    {blog.author.socials.map((social) => (
                      <span
                        key={social.platform}
                        className="tag tag-default tag-opposite tag-link-opposite"
                      >
                        <a
                          href={social.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {social.platform}
                        </a>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mxd-article-author__quote">
                <p>{blog.author.quote}</p>
              </div>
            </div>

            {/* ===== NAVIGATION ===== */}
            
          </div>
          {/* end .mxd-article-container */}

          {/* ===== COMMENTS ===== */}
          
        </div>
      </div>
    </div>
  );
}