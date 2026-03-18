"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { usePathname } from "next/navigation";

gsap.registerPlugin(ScrollTrigger);

export default function useGsapScrollScaleAnimations() {
  const pathname = usePathname();
  useEffect(() => {
    const initAnim = () => {
      const docStyle = getComputedStyle(document.documentElement);

      // ── Fade & slide up ──────────────────────────────────────────────────
      // Use ScrollTrigger.batch instead of one trigger per element.
      // This collapses ~40 individual ScrollTrigger instances into a handful
      // of handlers, dramatically reducing per-frame scroll work.
      // No onLeaveBack: elements stay visible once revealed — fixes the
      // "content disappears / doesn't reload" bug caused by reverse toggling.
      if (document.querySelector(".anim-uni-in-up")) {
        gsap.set(".anim-uni-in-up", { opacity: 0, y: 50 });
        ScrollTrigger.batch(".anim-uni-in-up", {
          start: "top 95%",
          onEnter: (els) =>
            gsap.to(els, {
              opacity: 1,
              y: 0,
              duration: 1.2,
              ease: "sine.out",
              stagger: 0.05,
              overwrite: true,
            }),
        });
      }

      // ── Scale-in center ──────────────────────────────────────────────────
      document.querySelectorAll<Element>(".anim-uni-scale-in").forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 50, scale: 1.2 },
          {
            y: 0,
            x: 0,
            opacity: 1,
            scale: 1,
            duration: 1.2,
            ease: "sine.out",
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          }
        );
      });

      // ── Scale-in from right ──────────────────────────────────────────────
      document.querySelectorAll<Element>(".anim-uni-scale-in-right").forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 50, x: -70, scale: 1.2 },
          {
            y: 0,
            x: 0,
            opacity: 1,
            scale: 1,
            duration: 1.2,
            ease: "sine.out",
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          }
        );
      });

      // ── Scale-in from left ───────────────────────────────────────────────
      document.querySelectorAll<Element>(".anim-uni-scale-in-left").forEach((el) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 50, x: 70, scale: 1.2 },
          {
            y: 0,
            x: 0,
            opacity: 1,
            scale: 1,
            duration: 1.2,
            ease: "sine.out",
            scrollTrigger: {
              trigger: el,
              start: "top 85%",
              toggleActions: "play none none none",
            },
          }
        );
      });

      // ── Top to bottom (scrub) ────────────────────────────────────────────
      // Collect all elements into one timeline so they share a single
      // ScrollTrigger instance instead of creating one per element.
      const toBottomEls = document.querySelectorAll<Element>(".anim-top-to-bottom");
      if (toBottomEls.length > 0) {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: ".fullwidth-text__tl-trigger",
            start: "top 99%",
            end: "top 24%",
            scrub: true,
          },
        });
        toBottomEls.forEach((e) => {
          tl.fromTo(
            e,
            { transform: "translate3d(0, -100%, 0)" },
            { transform: "translate3d(0, 0, 0)" },
            0 // all start at the same scroll position
          );
        });
      }

      // ── Zoom in container (scrub) ────────────────────────────────────────
      document.querySelectorAll<Element>(".anim-zoom-in-container").forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: el,
              start: "top 82%",
              end: "top 14%",
              scrub: true,
            },
          })
          .fromTo(
            el,
            { borderRadius: "200px", transform: "scale3d(0.94, 1, 1)" },
            {
              borderRadius: docStyle.getPropertyValue("--_radius-l"),
              transform: "scale3d(1, 1, 1)",
            }
          );
      });

      // ── Zoom out container (scrub) ───────────────────────────────────────
      document.querySelectorAll<Element>(".anim-zoom-out-container").forEach((el) => {
        gsap
          .timeline({
            scrollTrigger: {
              trigger: el,
              start: "top 82%",
              end: "top 14%",
              scrub: true,
            },
          })
          .fromTo(
            el,
            { borderRadius: "200px", transform: "scale3d(1.14, 1, 1)" },
            {
              borderRadius: docStyle.getPropertyValue("--_radius-l"),
              transform: "scale3d(1, 1, 1)",
            }
          );
      });

      // ── Batched cards ────────────────────────────────────────────────────
      const addCardBatch = (
        selector: string,
        opts: { batchMax: number; gridCols: number; delay?: number }
      ) => {
        if (!document.querySelector(selector)) return;
        gsap.set(selector, { y: 50, opacity: 0 });
        ScrollTrigger.batch(selector, {
          interval: 0.1,
          batchMax: opts.batchMax,
          start: "top 80%",
          onEnter: (els) =>
            gsap.to(els, {
              opacity: 1,
              y: 0,
              ease: "sine",
              stagger: { each: 0.15, grid: [1, opts.gridCols] },
              overwrite: true,
            }),
          onLeave: (els) => gsap.set(els, { opacity: 1, y: 0, overwrite: true }),
          onEnterBack: (els) =>
            gsap.to(els, { opacity: 1, y: 0, stagger: 0.15, overwrite: true }),
          onLeaveBack: (els) =>
            gsap.set(els, { opacity: 0, y: 50, overwrite: true }),
        });
      };

      addCardBatch(".animate-card-2", { batchMax: 2, gridCols: 2 });
      addCardBatch(".animate-card-3", { batchMax: 3, gridCols: 3 });
      addCardBatch(".animate-card-4", { batchMax: 4, gridCols: 4, delay: 1000 });
      addCardBatch(".animate-card-5", { batchMax: 5, gridCols: 5, delay: 1000 });

      // ── Page entrance (loading) ──────────────────────────────────────────
      const loadingWrap = document.querySelector(".loading-wrap");
      if (loadingWrap) {
        const loadingItems = loadingWrap.querySelectorAll(".loading__item");
        const fadeInItems = document.querySelectorAll(".loading__fade");

        gsap.set(loadingItems, { opacity: 0 });
        gsap.to(loadingItems, {
          duration: 1.1,
          ease: "power4",
          startAt: { y: 120 },
          y: 0,
          opacity: 1,
          delay: 0.8,
          stagger: 0.08,
        });

        gsap.set(fadeInItems, { opacity: 0 });
        gsap.to(fadeInItems, {
          duration: 0.8,
          ease: "none",
          opacity: 1,
          delay: 1.2,
        });
      }
    };

    let ctx: gsap.Context;
    const timer = setTimeout(() => {
      ctx = gsap.context(() => {
        initAnim();
      });

      // Refresh ScrollTrigger positions after fonts, images, and dynamic
      // layout (masonry, Lottie) have fully settled. Without this, position
      // calculations are based on partially-loaded page height and many
      // triggers never fire.
      if (document.readyState === "complete") {
        setTimeout(() => ScrollTrigger.refresh(), 300);
        setTimeout(() => ScrollTrigger.refresh(), 1500);
      } else {
        window.addEventListener("load", () => {
          setTimeout(() => ScrollTrigger.refresh(), 300);
          // Second refresh catches async layout changes from Ukiyo/BackgroundParallax
          // that initialize after window.load (image preload → Ukiyo wrap → height change)
          setTimeout(() => ScrollTrigger.refresh(), 1500);
        }, { once: true });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      ctx?.revert();
      ScrollTrigger.clearScrollMemory();
    };
  }, [pathname]);
}
