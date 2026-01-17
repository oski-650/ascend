"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

export default function ScrollToTop() {
  const pathname = usePathname();

  useEffect(() => {
    // run after next tick
    const timeout = setTimeout(() => {
      if (!window.location.hash) {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    }, 10); // small delay ensures Lenis/InitScroll have mounted

    return () => clearTimeout(timeout);
  }, [pathname]);

  return null;
}