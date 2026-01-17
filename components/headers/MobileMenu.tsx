"use client";
import Link from "next/link";
import menuItems from "@/data/menu.json"; // adjust path accordingly
import Logo from "../common/Logo"

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import gsap from "gsap";
import Flip from "gsap/Flip";
import { usePathname } from "next/navigation";
import AnimatedButton from "../animation/AnimatedButton";

gsap.registerPlugin(Flip);

export default function MobileMenu() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState(-1);
  const submenuRefs = useRef<(HTMLUListElement | null)[]>([]);
  // refs for the two *containers* the element will move between
  const hamburgerBtnRef = useRef<HTMLAnchorElement | null>(null); // .mxd-nav__hamburger
  const menuContainRef = useRef<HTMLDivElement | null>(null); // .mxd-menu__contain

  // the single element that flips between the two containers
  const flipBaseRef = useRef<HTMLDivElement | null>(null); // .hamburger__base

  // Store scrollHeight values
  const [submenuHeights, setSubmenuHeights] = useState<number[]>([]);
  const handleToggle = () => {
    if (isActive) {
      setIsActive(false);
      setTimeout(
        () => {
          setIsMenuOpen(false);
        },

        800
      );
    } else {
      setIsMenuOpen(true);
      setTimeout(
        () => {
          setIsActive(true);
        },

        600
      );
    }
  };
  const isMenuActive = (link?: string) =>
    link?.split("/")[1] == pathname.split("/")[1];

  useEffect(() => {
    // Get scrollHeight for each submenu and store in state
    const heights = submenuRefs.current.map((submenu) =>
      submenu ? submenu.scrollHeight : 0
    );
    setSubmenuHeights(heights);
  }, []);

  useEffect(() => {
    setActiveSubmenu(-1);
    if (isActive) {
      handleToggle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // === FLIP ONLY on state change ===
  useLayoutEffect(() => {
    const flipEl = flipBaseRef.current;
    const toMenu = isMenuOpen;

    if (!flipEl || !hamburgerBtnRef.current || !menuContainRef.current) return;

    // Capture current position/sizes before DOM move
    const state = Flip.getState(flipEl);

    // Move the node to its new container
    if (toMenu) {
      menuContainRef.current.appendChild(flipEl);
    } else {
      hamburgerBtnRef.current.appendChild(flipEl);
    }

    // Animate from previous to new layout
    Flip.from(state, {
      duration: 0.8,
      ease: "power4.inOut",
    });
  }, [isMenuOpen]);
  return (
    <nav
      className={`mxd-nav__wrap  ${isActive ? "active_menu" : ""} `}
      data-lenis-prevent=""
    >
      {/* Hamburger Start */}
      <div className="mxd-nav__contain loading__fade">
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            handleToggle();
          }}
          className={`mxd-nav__hamburger ${isMenuOpen ? "nav-open" : ""}`}
          ref={hamburgerBtnRef}
        >
          {/* flip element */}
          <div className="hamburger__base" ref={flipBaseRef} />
          <div className="hamburger__line" />
          <div className="hamburger__line" />
        </a>
      </div>
      {/* Hamburger End */}
      {/* Main Navigation Start */}
      <div className={`mxd-menu__wrapper ${isActive ? "active_menu" : ""} `}>
        {/* background active layer */}
        <div className="mxd-menu__base" />
        {/* menu container */}
        <div className="mxd-menu__contain" ref={menuContainRef}>
          <div className="mxd-menu__inner">
            {/* left side */}
            <div className="mxd-menu__left">
              <p
                className="mxd-menu__caption fade-in-elm"
                style={{ transitionDelay: "0.4s" }}
              >
                🚀 Elevate your business
                <br />
                with stunning websites
              </p>
              <div className="main-menu">
                <nav className="main-menu__content">
                  <ul id="main-menu" className="main-menu__accordion">
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.0s" }}>
                      <AnimatedButton text="Home" className="main-menu__link btn btn-anim" href="/" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.1s" }}>
                      <AnimatedButton text="Services" className="main-menu__link btn btn-anim" href="/services" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.2s" }}>
                      <AnimatedButton text="Work" className="main-menu__link btn btn-anim" href="/projects" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.3s" }}>
                      <AnimatedButton text="Pricing" className="main-menu__link btn btn-anim" href="/pricing" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.4s" }}>
                      <AnimatedButton text="Insights" className="main-menu__link btn btn-anim" href="/blog" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.5s" }}>
                      <AnimatedButton text="About" className="main-menu__link btn btn-anim" href="/about-us" />
                    </li>
                    <li className="main-menu__item fade-in-up-elm" style={{ transitionDelay: "0.6s" }}>
                      <AnimatedButton text="Contact" className="main-menu__link btn btn-anim" href="/contact" />
                    </li>
                  </ul>
                </nav>
              </div>
            </div>
            {/* right side */}
            {isActive && (
              <div className="mxd-menu__right">
                <div className="menu-promo">
                  <div className="menu-promo__content">
                    <p
                      className="menu-promo__caption fade-in-up-elm"
                      style={{ transitionDelay: "0.4s" }}
                    >
                      📈 Grow your business
                      <br />
                      with websites that convert
                    </p>
                    <div
                      className="menu-promo fade-in-up-elm"
                      style={{ transitionDelay: "0.5s" }}
                    >
                      <Logo width={120} height={120} forcedColor="dark"/> {/* optional sizing */}
                    </div>
                  </div>
                </div>
              </div>
            )}
            {/* data bottom line */}
            <div
              className="mxd-menu__data fade-in-up-elm"
              style={{ transitionDelay: "0.4s" }}
            >
              <p className="t-xsmall">
                Made with <i className="ph-fill ph-heart t-additional" /> by Ascend Web Solutions
              </p>
              <p className="t-xsmall">
               <i className="ph ph-copyright" /> 2026
            </p>
            </div>
          </div>
          <div className="hamburger__parking-slot" />
        </div>
      </div>
      {/* Main Navigation End */}
    </nav>
  );
}
