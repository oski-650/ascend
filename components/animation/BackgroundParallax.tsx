"use client";

import { ElementType, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import Ukiyo from "ukiyojs";

type HtmlTag = keyof HTMLElementTagNameMap;

type BackgroundParallaxProps<T extends HtmlTag = "div"> = {
  as?: T;
  className?: string;

  /** background image src */
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

    // Destroy any existing instance before creating a new one
    if ((elRef.current as any).__ukiyo_instance) {
      const oldInstance = (elRef.current as any).__ukiyo_instance;
      const oldTick = (elRef.current as any).__gsap_tick;
      if (oldTick) gsap.ticker.remove(oldTick);
      oldInstance.destroy();
      delete (elRef.current as any).__ukiyo_instance;
      delete (elRef.current as any).__gsap_tick;
    }

    // Wait for the background image to load before initializing Ukiyo
    const img = new Image();
    const initUkiyo = () => {
      if (!elRef.current) return;

      // Ensure background image is set before Ukiyo initializes
      elRef.current.style.backgroundImage = `url(${image})`;
      elRef.current.style.backgroundPosition = 'center';
      // Let Ukiyo handle background-size

      const instance = new Ukiyo(elRef.current, {
        scale,
        speed,
        willChange,
        wrapperClass,
        externalRAF: true,
      });

      const tick = () => instance.animate();
      gsap.ticker.add(tick);

      // Store instance for cleanup
      (elRef.current as any).__ukiyo_instance = instance;
      (elRef.current as any).__gsap_tick = tick;
    };

    img.onload = initUkiyo;
    img.onerror = initUkiyo; // Initialize even if image fails to load
    img.src = image;

    // Handle cached images that may not trigger onload
    if (img.complete) {
      // Small delay to ensure DOM is ready
      setTimeout(initUkiyo, 10);
    }

    return () => {
      if (elRef.current) {
        const instance = (elRef.current as any).__ukiyo_instance;
        const tick = (elRef.current as any).__gsap_tick;
        if (instance && tick) {
          gsap.ticker.remove(tick);
          instance.destroy();
          delete (elRef.current as any).__ukiyo_instance;
          delete (elRef.current as any).__gsap_tick;
        }
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