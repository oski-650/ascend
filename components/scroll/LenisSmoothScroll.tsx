"use client";
import ReactLenis, { useLenis } from "lenis/react";
import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

// autoRaf: false — GSAP's ticker drives Lenis instead of Lenis running
// its own requestAnimationFrame loop. This is the critical fix for
// "not buttery" scroll: without it, Lenis and GSAP fire on separate RAF
// cycles and can be one frame out of sync, causing visible jank on every
// frame where a GSAP animation reads a stale Lenis scroll position.
const LENIS_OPTIONS = {
  lerp: 0.08,
  smoothWheel: true,
  autoRaf: false,
  easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
};

function LenisSync() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return;

    // No lag smoothing — GSAP must never try to "catch up" on dropped
    // frames by speeding animations. With Lenis driving scroll, any
    // catch-up would cause a visible lurch.
    gsap.ticker.lagSmoothing(0);

    // Let GSAP's ticker call lenis.raf() on every frame.
    // GSAP time is in seconds; lenis.raf() expects milliseconds.
    const tickerFn = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tickerFn);

    // lenis.raf() fires Lenis's scroll event internally, which then
    // calls ScrollTrigger.update() to keep ScrollTrigger in sync.
    lenis.on("scroll", ScrollTrigger.update);

    let resizeTimer: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => ScrollTrigger.refresh(), 200);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      gsap.ticker.remove(tickerFn);
      lenis.off("scroll", ScrollTrigger.update);
      clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, [lenis]);

  return null;
}

export default function LenisSmoothScroll() {
  // Native iOS momentum scroll is smoother than Lenis on touch devices
  const isIOS =
    typeof window !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) return null;

  return (
    <ReactLenis root options={LENIS_OPTIONS}>
      <LenisSync />
    </ReactLenis>
  );
}
