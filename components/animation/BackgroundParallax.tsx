"use client";

import { ElementType, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import Ukiyo from "ukiyojs";

type HtmlTag = keyof HTMLElementTagNameMap;

type BackgroundParallaxProps<T extends HtmlTag = "div"> = {
  as?: T;
  className?: string;
  image?: string;
  scale?: number;
  speed?: number;
  willChange?: boolean;
  wrapperClass?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, "as" | "className">;

const BackgroundParallax = <T extends HtmlTag = "div">({
  as,
  className,
  image,
  scale = 1.05,
  speed = 1.5,
  willChange = true,
  wrapperClass,
  children,
  ...rest
}: BackgroundParallaxProps<T>) => {
  const elRef = useRef<HTMLElement | null>(null);
  const Tag = (as ?? "div") as ElementType;

  useLayoutEffect(() => {
    if (!elRef.current || !image) return;

    // Clean up any previous instance on this element
    const prev = elRef.current as any;
    if (prev.__ukiyo_instance) {
      if (prev.__gsap_tick) gsap.ticker.remove(prev.__gsap_tick);
      prev.__ukiyo_instance.destroy();
      delete prev.__ukiyo_instance;
      delete prev.__gsap_tick;
    }

    const el = elRef.current;

    const init = () => {
      if (!el) return;

      el.style.backgroundImage = `url(${image})`;
      el.style.backgroundPosition = "center";

      const instance = new Ukiyo(el, {
        scale,
        speed,
        willChange,
        wrapperClass,
        externalRAF: true,
      });

      // Only call animate() when the element is actually visible.
      // Without this, every BackgroundParallax on the page runs a
      // getBoundingClientRect + transform write on every single frame,
      // even when the element is completely off-screen.
      let inView = false;
      const observer = new IntersectionObserver(
        ([entry]) => { inView = entry.isIntersecting; },
        { rootMargin: "200px 0px" } // start slightly before entering viewport
      );
      observer.observe(el);

      const tick = () => { if (inView) instance.animate(); };
      gsap.ticker.add(tick);

      (el as any).__ukiyo_instance = instance;
      (el as any).__gsap_tick = tick;
      (el as any).__observer = observer;
    };

    const img = new Image();
    img.onload = init;
    img.onerror = init;
    img.src = image;
    if (img.complete) setTimeout(init, 10);

    return () => {
      const stored = elRef.current as any;
      if (stored) {
        if (stored.__gsap_tick) gsap.ticker.remove(stored.__gsap_tick);
        if (stored.__ukiyo_instance) stored.__ukiyo_instance.destroy();
        if (stored.__observer) stored.__observer.disconnect();
        delete stored.__ukiyo_instance;
        delete stored.__gsap_tick;
        delete stored.__observer;
      }
    };
  }, [image, scale, speed, willChange, wrapperClass]);

  return (
    <Tag
      ref={elRef}
      className={className}
      style={
        image
          ? {
              backgroundImage: `url(${image})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default BackgroundParallax;
