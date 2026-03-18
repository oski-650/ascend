"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lottie, { LottieRefCurrentProps } from "lottie-react";

import services from "@/data/services/services-web-agency.json";
import { Service } from "@/types/services";

import lottieSEO from "./lottie/SEO.json";
import lottieStrategy from "./lottie/strategy.json";
import lottieWebDesign from "./lottie/webDesign.json";
import lottieWebDev from "./lottie/WebDevelopment.json";

const lottieMap: { [key: string]: any } = {
  "SEO.json": lottieSEO,
  "strategy.json": lottieStrategy,
  "webDesign.json": lottieWebDesign,
  "WebDevelopment.json": lottieWebDev,
};

gsap.registerPlugin(ScrollTrigger);

export default function Services() {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef<HTMLDivElement | null>(null);

  // Refs for desktop Lottie instances (only visible on ≥1200px)
  const desktopRefs = useRef<{ current: LottieRefCurrentProps | null }[]>(
    services.map(() => ({ current: null }))
  );
  // Refs for mobile Lottie instances (only visible on <1200px)
  const mobileRefs = useRef<{ current: LottieRefCurrentProps | null }[]>(
    services.map(() => ({ current: null }))
  );

  const activeIdx = useRef(0);

  useEffect(() => {
    const root = pinnedRef.current;
    const section = sectionRef.current;
    if (!root || !section) return;

    const isDesktop = () => window.matchMedia("(min-width: 1200px)").matches;

    // Play only the active Lottie for the current layout
    const playActive = (idx: number) => {
      if (isDesktop()) {
        desktopRefs.current.forEach((ref, i) => {
          if (!ref.current) return;
          if (i === idx) ref.current.play();
          else ref.current.pause();
        });
        // Mobile hidden on desktop — pause all
        mobileRefs.current.forEach((ref) => ref.current?.pause());
      } else {
        mobileRefs.current.forEach((ref, i) => {
          if (!ref.current) return;
          if (i === idx) ref.current.play();
          else ref.current.pause();
        });
        // Desktop hidden on mobile — pause all
        desktopRefs.current.forEach((ref) => ref.current?.pause());
      }
    };

    const textItems = Array.from(
      root.querySelectorAll<HTMLElement>(".mxd-pinned__text-item")
    );
    const imgItems = Array.from(
      root.querySelectorAll<HTMLElement>(".mxd-pinned__img-item")
    );

    const count = Math.min(textItems.length, imgItems.length);
    if (count === 0) return;

    const setActive = (idx: number) => {
      activeIdx.current = idx;
      textItems.forEach((el) => el.classList.remove("is-active"));
      imgItems.forEach((el) => el.classList.remove("is-active"));
      textItems[idx]?.classList.add("is-active");
      imgItems[idx]?.classList.add("is-active");
      playActive(idx);
    };

    setActive(0);

    // Pause ALL Lotties when section is off-screen — no wasted RAF
    const sectionObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          playActive(activeIdx.current);
        } else {
          desktopRefs.current.forEach((ref) => ref.current?.pause());
          mobileRefs.current.forEach((ref) => ref.current?.pause());
        }
      },
      { rootMargin: "200px 0px" }
    );
    sectionObserver.observe(section);

    const triggers: ScrollTrigger[] = [];
    textItems.slice(0, count).forEach((el, idx) => {
      const st = ScrollTrigger.create({
        trigger: el,
        start: "top center",
        end: "bottom center",
        onToggle: (self) => {
          if (self.isActive) setActive(idx);
        },
      });
      triggers.push(st);
    });

    // Pause the active Lottie while scrolling — SVG DOM updates at 60fps
    // compete directly with Lenis smooth scroll for the 16ms frame budget.
    // The user is reading text while scrolling, not watching the animation.
    // Resume 150ms after scroll stops so the animation plays when idle.
    const pauseAllLotties = () => {
      desktopRefs.current.forEach((ref) => ref.current?.pause());
      mobileRefs.current.forEach((ref) => ref.current?.pause());
    };

    let scrollResumeTimer: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      pauseAllLotties();
      clearTimeout(scrollResumeTimer);
      scrollResumeTimer = setTimeout(() => {
        playActive(activeIdx.current);
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      triggers.forEach((st) => st.kill());
      sectionObserver.disconnect();
      clearTimeout(scrollResumeTimer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div ref={sectionRef} className="mxd-section padding-pinned-img-pre-mtext">
      <div className="mxd-container">
        {/* Block - Services Pinned Image Start */}
        <div className="mxd-block">
          <div className="mxd-pinned" ref={pinnedRef}>
            <div className="mxd-pinned__visual page-padding">
              <div className="mxd-pinned__img-wrap">
                <div className="mxd-pinned__img-list" role="list">
                  {services.map((item: Service, idx: number) => (
                    <div className="mxd-pinned__img-item" role="listitem" key={idx}>
                      {item.lottie && lottieMap[item.lottie] ? (
                        <Lottie
                          lottieRef={desktopRefs.current[idx]}
                          animationData={lottieMap[item.lottie]}
                          loop
                          autoplay={idx === 0}
                          className="mxd-pinned__img"
                          onDOMLoaded={() =>
                            desktopRefs.current[idx].current?.setSubframe(false)
                          }
                        />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mxd-pinned__content page-padding">
              <div className="mxd-pinned__text-wrap">
                <div className="mxd-pinned__text-list" role="list">
                  {services.map((item: Service, idx: number) => (
                    <div
                      className="mxd-pinned__text-item"
                      role="listitem"
                      key={idx}
                    >
                      <div className="mxd-pinned__img-mobile anim-uni-in-up">
                        {item.lottie && lottieMap[item.lottie] ? (
                          <Lottie
                            lottieRef={mobileRefs.current[idx]}
                            animationData={lottieMap[item.lottie]}
                            loop
                            autoplay={idx === 0}
                            onDOMLoaded={() =>
                              mobileRefs.current[idx].current?.setSubframe(false)
                            }
                          />
                        ) : null}
                      </div>

                      <h2 className="mxd-pinned__title h2-small anim-uni-in-up">
                        {item.title}
                      </h2>

                      <div className="mxd-pinned__tags">
                        {item.tags.map((tag, tagIdx) => (
                          <span
                            className="tag tag-default tag-outline anim-uni-in-up"
                            key={tagIdx}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      <p className="anim-uni-in-up">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Block - Services Pinned Image End */}
      </div>
    </div>
  );
}
