"use client";
import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import Ukiyo from "ukiyojs";

type UkiyoBgProps = {
  className?: string;
  scale?: number; // default 1.2
  speed?: number; // default 1.5
  willChange?: boolean; // default true
  src?: string; // video source
  poster?: string; // poster image shown until the video can play
  wrapperClass?: string; // optional ukiyo wrapper class
};

const VideoParallax = ({
  className,
  scale = 1.2,
  speed = 1.5,
  willChange = true,
  wrapperClass,
  src = "/video/1920x1080_video-05.webm",
  poster = "/video/1920x1080_video-05.webp",
}: UkiyoBgProps) => {
  const elRef = useRef<HTMLVideoElement | null>(null);

  useLayoutEffect(() => {
    const video = elRef.current;
    if (!video) return;

    const instance = new Ukiyo(video, {
      scale,
      speed,
      willChange,
      wrapperClass,
      externalRAF: true, // we’ll drive it with GSAP’s ticker
    });

    // Only animate and play while near the viewport. Off-screen, the parallax
    // math and video decoding are wasted work competing with scrolling.
    let inView = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        if (inView) {
          if (video.preload !== "auto") video.preload = "auto";
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { rootMargin: "200px 0px" }
    );
    observer.observe(video);

    const tick = () => {
      if (inView) instance.animate();
    };
    gsap.ticker.add(tick);

    return () => {
      observer.disconnect();
      gsap.ticker.remove(tick);
      instance.destroy();
    };
  }, [scale, speed, willChange, wrapperClass]);

  return (
    <video
      preload="none"
      loop
      muted
      playsInline
      src={src}
      poster={poster}
      ref={elRef}
      className={className}
    ></video>
  );
};

export default VideoParallax;
