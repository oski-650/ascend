"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import AnimatedButton from "../animation/AnimatedButton";
import { usePathname } from "next/navigation";
import ThemeSwitcherButton from "./ColorSwitcher";

export default function Header1() {
  const pathname = usePathname();
  const [isHidden, setIsHidden] = useState(false);
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollPos = window.pageYOffset;
      setIsHidden(currentScrollPos > 10);
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Track theme changes
  useEffect(() => {
    const currentTheme = document.documentElement.getAttribute("color-scheme");
    setTheme(currentTheme);

    const handleThemeChange = (e: CustomEvent) => {
      setTheme(e.detail);
    };

    document.addEventListener("color-scheme-change", handleThemeChange as EventListener);
    return () => document.removeEventListener("color-scheme-change", handleThemeChange as EventListener);
  }, []);

  // Both SVGs use identical path coordinates, only fills differ
  const darkSVG = (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15.4864 26.1567L0 56H16.2469L20.7407 47.3981V26.1567H15.4864Z" fill="#F4F5F7"/>
      <path d="M35.121 26.1567H40.3753L56 56H39.7531L35.121 47.5737V26.1567Z" fill="#F4F5F7"/>
      <path d="M32.3556 52.3135H23.5062V19.6614H17.5605L27.9309 0L38.4395 19.6614H32.3556V52.3135Z" fill="#006B40"/>
    </svg>
  );

  const lightSVG = (
    <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M15.4864 26.1567L0 56H16.2469L20.7407 47.3981V26.1567H15.4864Z" fill="#1A1A1A"/>
      <path d="M35.121 26.1567H40.3753L56 56H39.7531L35.121 47.5737V26.1567Z" fill="#1A1A1A"/>
      <path d="M32.3556 52.3135H23.5062V19.6614H17.5605L27.9309 0L38.4395 19.6614H32.3556V52.3135Z" fill="#006B40"/>
    </svg>
  );

  return (
    <header id="header" className={`mxd-header ${isHidden ? "is-hidden" : ""}`}>
      <div className="mxd-header__logo loading__fade">
        <Link href={`/`} className="mxd-logo">
          {theme === "dark" ? darkSVG : lightSVG}
          <span className="mxd-logo__text">
            Ascend
            <br />
            Web Solutions
          </span>
        </Link>
      </div>

      <div className="mxd-header__controls loading__fade">
        <ThemeSwitcherButton />
        {pathname == "/" || pathname == "/preview" ? (
          <AnimatedButton
            text="Get Started"
            className="btn btn-anim btn-default btn-mobile-icon btn-outline slide-right"
            href="/contact"
          >
            <i className="ph-bold ph-rocket-launch" />
          </AnimatedButton>
        ) : (
          <AnimatedButton
            text="Back to Home"
            className="btn btn-anim btn-default btn-mobile-icon btn-outline slide-right"
            href="/"
          >
            <i className="ph-bold ph-house" />
          </AnimatedButton>
        )}
      </div>
    </header>
  );
}