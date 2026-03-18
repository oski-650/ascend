"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

type VelocityMarqueeProps = {
  className?: string;
  duration?: number;
  direction?: "left" | "right";
  minScale?: number;
  maxScale?: number;
  pauseOnHover?: boolean;
  children: React.ReactNode;
};

export default function VelocityMarquee({
  className,
  duration = 20,
  direction = "right",
  minScale = 1,
  maxScale = 6,
  pauseOnHover = false,
  children,
}: VelocityMarqueeProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const dirDelta = useMemo(
    () => (direction === "left" ? "-=50%" : "+=50%"),
    [direction]
  );

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;

    let st: ScrollTrigger | null = null;
    let tickerFn: ((time: number, deltaTime: number) => void) | null = null;
    let visObserver: IntersectionObserver | null = null;

    const ctx = gsap.context(() => {
      const clamp = gsap.utils.clamp(minScale, maxScale);

      gsap.set(track, { clearProps: "x,xPercent", x: 0, xPercent: 0 });
      if (direction === "right") gsap.set(track, { xPercent: -50 });

      const master = gsap.timeline({ defaults: { overwrite: "auto" } });
      master.add(
        gsap.to(track, { x: dirDelta, duration, ease: "none", repeat: -1 }),
        0
      );

      // Track velocity as a target — updated only when scrolling
      let targetScale = 1;

      st = ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate(self) {
          // Just store the target — no tween creation, no invalidate, no restart
          targetScale = clamp(Math.abs(self.getVelocity() / 200));
        },
      });

      // Smooth lerp toward target in the GSAP ticker.
      // This replaces kicker.invalidate().restart() which was running
      // 3 expensive GSAP operations per frame across each marquee instance.
      tickerFn = () => {
        // Decay target back toward 1 when not scrolling
        targetScale = gsap.utils.interpolate(targetScale, 1, 0.06);
        const current = master.timeScale();
        const next = gsap.utils.interpolate(
          current,
          Math.max(targetScale, 1),
          0.12
        );
        if (Math.abs(next - current) > 0.001) master.timeScale(next);
      };
      gsap.ticker.add(tickerFn);

      // Pause the timeline + ticker entirely when off-screen.
      // Off-screen marquees were still running transform animations and
      // lerp calculations every frame — stopping them frees the budget
      // for smooth scroll in other sections.
      let inView = false;
      visObserver = new IntersectionObserver(
        ([entry]) => {
          inView = entry.isIntersecting;
          if (inView) master.play();
          else master.pause();
        },
        { rootMargin: "100px 0px" }
      );
      visObserver.observe(wrap);

      if (pauseOnHover) {
        const onEnter = () => { if (inView) master.pause(); };
        const onLeave = () => { if (inView) master.play(); };
        wrap.addEventListener("mouseenter", onEnter);
        wrap.addEventListener("mouseleave", onLeave);
        ctx.add(() => {
          wrap.removeEventListener("mouseenter", onEnter);
          wrap.removeEventListener("mouseleave", onLeave);
        });
      }
    }, wrap);

    return () => {
      if (tickerFn) gsap.ticker.remove(tickerFn);
      visObserver?.disconnect();
      st?.kill();
      ctx.revert();
    };
  }, [dirDelta, direction, duration, minScale, maxScale, pauseOnHover]);

  return (
    <div ref={wrapRef} className={className} style={{ overflow: "hidden" }}>
      <div
        ref={trackRef}
        className="marquee-flex"
        style={{ display: "inline-flex", whiteSpace: "nowrap", willChange: "transform" }}
      >
        {children}
        {children}
      </div>
    </div>
  );
}
