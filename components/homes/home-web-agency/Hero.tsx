"use client";

import Link from "next/link";
import Image from "next/image";
import Player from "lottie-react";
import webAnimation from "./lottie/web.json";
import { useEffect, useRef } from "react";
import { LottieRefCurrentProps } from "lottie-react";
import AnimatedButton from "@/components/animation/AnimatedButton";

export default function Hero() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const lottieRef = useRef<LottieRefCurrentProps | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    // Pause Hero Lottie and video when the hero scrolls off-screen.
    // Both have their own animation loops that compete with scroll
    // animations in every other section below.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          lottieRef.current?.play();
          videoRef.current?.play().catch(() => {});
        } else {
          lottieRef.current?.pause();
          videoRef.current?.pause();
        }
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(section);

    // Pause Lottie while scrolling — 284KB SVG animation updates DOM at 60fps.
    // Resume 150ms after scroll stops (user is idle / reading hero content).
    let scrollResumeTimer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      lottieRef.current?.pause();
      clearTimeout(scrollResumeTimer);
      scrollResumeTimer = setTimeout(() => {
        lottieRef.current?.play();
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      clearTimeout(scrollResumeTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div ref={sectionRef} className="mxd-section mxd-hero-section padding-grid-pre-mtext">
      <div className="mxd-hero-05">
        <div className="mxd-hero-05__wrap loading-wrap">
          {/* Top Hero Section */}
          <div className="mxd-hero-05__top">
            <div className="mxd-hero-05__headline">
              <div className="container-fluid p-0">
                <div className="row g-0 d-flex flex-column flex-xl-row">
                  <div className="col-12 col-xl-8 col-xxl-10 order-2 order-xl-1 mxd-grid-item no-margin">
                    {/* Hero Title */}
                    <h1 className="hero-05-title">
                      <span className="hero-05-title__row loading__item">
                        <em className="hero-05-title__item">Built to convert,</em>
                      </span>
                      <span className="hero-05-title__row loading__item">
                        <em className="hero-05-title__item title-item-image">
                          {/* optional SVG pulse icon */}
                        </em>
                        <em className="hero-05-title__item">designed to last</em>
                      </span>
                    </h1>
                  </div>

                  <div className="col-12 col-xl-4 col-xxl-2 order-1 order-xl-2 mxd-grid-item no-margin">
                    {/* Clients avatars */}
                    <div className="hero-05-headline__avatars loading__fade">
                      <div className="mxd-avatars-group align-right">
                        <div className="mxd-avatars align-right">
                          <div className="mxd-avatars__item small">
                            <Image
                              alt="Avatar"
                              src="/img/avatars/review8.jpg"
                              width={300}
                              height={300}
                            />
                          </div>
                          <div className="mxd-avatars__item small bg-base-opp">
                            <svg
                              className="mxd-avatars__icon small"
                              version="1.1"
                              xmlns="http://www.w3.org/2000/svg"
                              xmlnsXlink="http://www.w3.org/1999/xlink"
                              x="0px"
                              y="0px"
                              width="60px"
                              height="60px"
                              viewBox="0 0 60 60"
                              enableBackground={"new 0 0 60 60"}
                              xmlSpace="preserve"
                            >
                              <style
                                type="text/css"
                                dangerouslySetInnerHTML={{
                                  __html:
                                    "\n.icon-star { fill: var(--additional); }\n",
                                }}
                              />
                              <path
                                className="icon-star"
                                d="M58.9,28.9c0,0-9.1,0.1-12.1,0c-1.3,0-5.3-0.5-5.3-0.5c-1.7-0.2-3.4-0.7-4.8-1.7c-1.4-1-2.7-2.3-3.6-3.7
                                  c-0.8-1.3-1.3-2.7-1.5-4.2c0,0-0.4-3.3-0.5-4.4c-0.2-3.3,0-13.1,0-13.1c0-0.6-0.5-1.1-1.1-1.1s-1.1,0.5-1.1,1.1
                                  c0,0,0.2,9.8,0,13.1c0,1.1-0.5,4.4-0.5,4.4c-0.2,1.5-0.6,3-1.5,4.2c-0.9,1.5-2.2,2.7-3.6,3.7s-3,1.5-4.7,1.7c0,0-3.7,0.4-5,0.5
                                  c-3.1,0.2-12.5,0-12.5,0C0.5,28.9,0,29.4,0,30s0.5,1.1,1.1,1.1c0,0,9.4-0.2,12.5,0c1.2,0,5,0.5,5,0.5c1.7,0.2,3.3,0.7,4.7,1.7
                                  c1.3,0.9,2.4,2,3.3,3.3c1,1.4,1.5,3.1,1.7,4.8c0,0,0.4,3.9,0.5,5.2c0.1,3,0,12.2,0,12.2c0,0.6,0.5,1.1,1.1,1.1s1.1-0.5,1.1-1.1
                                  c0,0-0.1-9.2,0-12.2c0-1.3,0.5-5.2,0.5-5.2c0.2-1.7,0.7-3.4,1.7-4.8c0.9-1.3,2-2.4,3.3-3.3c1.4-1,3.1-1.5,4.8-1.7
                                  c0,0,3.9-0.4,5.3-0.5c3-0.1,12.1,0,12.1,0c0.6,0,1.1-0.5,1.1-1.1s-0.5-1.1-1.1-1.1l0,0L58.9,28.9z"
                              />
                            </svg>
                          </div>
                          <div className="mxd-avatars__item small">
                            <Image
                              alt="Avatar"
                              src="/img/avatars/review2.jpg"
                              width={300}
                              height={300}
                            />
                          </div>
                        </div>
                        <div className="mxd-avatars-group__text">
                          <p>
                            Real results for
                            <br />
                            <Link href="/services">real clients</Link>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Hero Section */}
          <div className="mxd-hero-05__bottom mxd-grid-item no-margin">
            <div className="mxd-hero-05__worksblock loading__item">
              <Player
                lottieRef={lottieRef}
                animationData={webAnimation}
                className="mxd-move"
                loop
                autoplay
                style={{ width: "100%", maxWidth: 400, height: "auto" }}
                onDOMLoaded={() => lottieRef.current?.setSubframe(false)}
              />
              <div className="hero-05-worksblock__descr">
                <p className="t-large t-caption t-bright">
                  Thoughtful design backed by real strategy
                </p>
                <AnimatedButton
                  text="Explore"
                  className="btn btn-anim btn-default btn-outline slide-right-up"
                  href={`/projects`}
                >
                  <i className="ph-bold ph-arrow-up-right" />
                </AnimatedButton>
              </div>
            </div>

            {/* Video Background */}
            <div className="mxd-hero-05__videoblock loading__item">
              <div className="mxd-hero-05-videoblock__video">
                <video
                  ref={videoRef}
                  preload="metadata"
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="mxd-hero-video"
                >
                  <source type="video/mp4" src="/video/hero/heroVid01.mp4" />
                </video>
              </div>
              <div className="mxd-hero-05-videoblock__descr">
                <p className="t-large t-caption t-bright">
                  Custom websites for California businesses — designed to attract the right audience, convert visitors, and support long-term growth.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
