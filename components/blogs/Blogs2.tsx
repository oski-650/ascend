import Link from "next/link";
import Image from "next/image";
import blogsData from "@/data/blogs.json"; // make sure this is the file with your new blogs.json format

// -------------------- Shared bits --------------------
const StarSvg = () => (
  <svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 20 20">
    <path d="M19.6,9.6h-3.9c-.4,0-1.8-.2-1.8-.2-.6,0-1.1-.2-1.6-.6-.5-.3-.9-.8-1.2-1.2-.3-.4-.4-.9-.5-1.4,0,0,0-1.1-.2-1.5V.4c0-.2-.2-.4-.4-.4s-.4.2-.4.4v4.4c0,.4-.2,1.5-.2,1.5,0,.5-.2,1-.5,1.4-.3.5-.7.9-1.2,1.2s-1,.5-1.6.6c0,0-1.2,0-1.7.2H.4c-.2,0-.4.2-.4.4s.2.4.4.4h4.1c.4,0,1.7.2,1.7.2.6,0,1.1.2,1.6.6.4.3.8.7,1.1,1.1.3.5.5,1,.6,1.6,0,0,0,1.3.2,1.7v4.1c0,.2.2.4.4.4s.4-.2.4-.4v-4.1c0-.4.2-1.7.2-1.7,0-.6.2-1.1.6-1.6.3-.4.7-.8,1.1-1.1.5-.3,1-.5,1.6-.6,0,0,1.3,0,1.8-.2h3.9c.2,0,.4-.2.4-.4s-.2-.4-.4-.4h0Z" />
  </svg>
);

const MetaTag: React.FC<{ label: string }> = ({ label }) => (
  <span className="meta-tag">
    <a href="#">{label}</a>
    <StarSvg />
  </span>
);

export default function Blogs2() {
  // Use all blogs from blogs.json
  const { blogs } = blogsData;

  // We'll pick first blog as featured, next few as secondary, rest as archive
  const featured = blogs.slice(0, 1);
  const secondary = blogs.slice(1, 3);
  const archive = blogs.slice(3);

  return (
    <>
      {/* Section - Inner Page Headline Start */}
      <div className="mxd-section mxd-section-inner-headline padding-blog-descr-pre-grid">
        <div className="mxd-container grid-container">
          <div className="mxd-block loading-wrap">
            <div className="container-fluid px-0">
              <div className="row gx-0">
                <div className="col-12 col-xl-7 mxd-grid-item no-margin">
                  <div className="mxd-block__content">
                    <div className="mxd-block__inner-headline loading__item">
                      <h1 className="inner-headline__title headline-img-before headline-img-06">
                        Ascend Insights
                      </h1>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-xl-5 mxd-grid-item no-margin">
                  <div className="mxd-block__content">
                    <div className="inner-headline__descr loading__item">
                      <p>
                        Explore actionable tips, industry updates, and case studies from Ascend Web Solutions to help you grow your digital presence.
                      </p>
                    </div>
                  </div>
                </div>
                {/* Inner Headline Aside End */}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Section - Inner Page Headline End */}

      {/* Section - Blog Start */}
      <div className="mxd-section padding-pre-title">
        <div className="mxd-container grid-container">
          <div className="mxd-posts-area column loading__fade">
            {/* Featured Post */}
            <div className="mxd-posts-container fullwidth-posts-container mxd-grid-item">
              {featured.map((f) => (
                <article key={f.slug} className="mxd-post post-featured post-featured-v2 radius-l">
                  <Link className="post-featured__thumb" href={`/blog-article/${f.slug}`}>
                    <Image
                      alt={f.title}
                      src={f.thumbnail}
                      width={1400}
                      height={900}
                    />
                  </Link>

                  <div className="post-featured__categories">
                    {f.tags.map((tag) => (
                      <span key={tag} className="tag tag-default tag-outline-permanent tag-link-outline-premanent">
                        <a href="#">{tag}</a>
                      </span>
                    ))}
                  </div>

                  <div className="post-featured__content">
                    <div className="post-featured__meta">
                      <span className="meta-date">{f.date}</span>
                      <span className="meta-time">{f.readTime}</span>
                    </div>

                    <h3 className="post-featured__title">
                      <Link href={`/blog-article/${f.slug}`}>{f.title}</Link>
                    </h3>

                    <div className="post-featured__excerpt">
                      <p>{f.excerpt}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* Secondary Posts */}
            <div className="mxd-posts-container fullwidth-posts-container">
              <div className="container-fluid p-0">
                <div className="row g-0">
                  {secondary.map((s) => (
                    <div className="col-12 col-xl-6 mxd-grid-item" key={s.slug}>
                      <article className="mxd-post post-secondary">
                        <Link className="post-secondary__thumb radius-l" href={`/blog-article/${s.slug}`}>
                          <Image alt={s.title} src={s.thumbnail} width={1000} height={1250} />
                        </Link>

                        <div className="post-secondary__categories">
                          {s.tags.map((tag) => (
                            <span key={tag} className="tag tag-default tag-outline-permanent tag-link-outline-premanent">
                              <a href="#">{tag}</a>
                            </span>
                          ))}
                        </div>

                        <div className="post-secondary__descr">
                          <div className="post-secondary__meta">
                            <span className="meta-date">{s.date}</span>
                            <span className="meta-time">{s.readTime}</span>
                          </div>

                          <div className="post-secondary__title">
                            <h5>
                              <Link href={`/blog-article/${s.slug}`}>{s.title}</Link>
                            </h5>
                          </div>
                        </div>
                      </article>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Archive Posts */}
            <div className="mxd-projects-archive">
              {archive.map((item) => (
                <Link key={item.slug} className="mxd-projects-archive__item" href={`/blog-article/${item.slug}`}>
                  <div className="mxd-projects-archive__inner">
                    <div className="container-fluid px-0">
                      <div className="row gx-0">
                        <div className="col-12 col-xl-8 mxd-grid-item no-margin">
                          <div className="mxd-projects-archive__title">
                            <div className="mxd-projects-archive__image">
                              <Image
                                alt={item.title}
                                src={item.thumbnail}
                                width={1200}
                                height={800}
                              />
                            </div>
                            <p>
                              <span>{item.title}</span>
                            </p>
                          </div>
                        </div>
                        <div className="col-6 col-md-6 col-xl-2 mxd-grid-item no-margin">
                          <div className="mxd-projects-archive__tagslist">
                            <ul>
                              {item.tags.map((t) => (
                                <li key={t}>
                                  <p className="t-small">{t}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                        <div className="col-6 col-md-6 col-xl-2 mxd-grid-item no-margin">
                          <div className="mxd-projects-list__date">
                            <p className="t-small">{item.date}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
      {/* Section - Blog End */}
    </>
  );
}