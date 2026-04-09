"use client";

import { useRef, useEffect } from "react";
import AnimatedButton from "@/components/animation/AnimatedButton";
import FeedTicker from "./FeedTicker";
import { useEngineModal } from "./EngineModalContext";

const TICKER_ITEMS = [
  "$1,200 HVAC Lead Captured — Chicago, IL",
  "4.8s Response Time — Lead Answered Instantly",
  "Quote Approved — Austin, TX — $3,400",
  "Appointment Booked — San Jose, CA",
  "Roofing Lead Qualified — $3,800 Est.",
  "Follow-Up Sent — Job #0447 — Plumbing",
  "Emergency Call Handled — 11:52 PM",
  "Invoice Reminder Sent — $1,100 Collected",
];

export default function AscendEngineHero() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { openModal } = useEngineModal();

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const onMove = (e: MouseEvent) => {
      const x = ((e.clientX / window.innerWidth) - 0.5) * 30;
      const y = ((e.clientY / window.innerHeight) - 0.5) * 30;
      hero.style.setProperty("--grid-x", `${x}px`);
      hero.style.setProperty("--grid-y", `${y}px`);
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  const doubled = [...TICKER_ITEMS, ...TICKER_ITEMS];

  return (
    <div className="ae-page-hero" ref={heroRef}>

      {/* Tactical grid overlay */}
      <div className="ae-page-hero__grid" />

      <div className="mxd-container grid-container">
        <div className="mxd-block">
          <div className="container-fluid px-0">
            <div className="row gx-0 align-items-center">

              {/* Left — 60% */}
              <div className="col-12 col-xl-7 mxd-grid-item no-margin">
                <div className="ae-page-hero__left">

                  {/* Eyebrow */}
                  <p className="ae-page-hero__eyebrow">
                    <span className="ae-page-hero__eyebrow-dot" />
                    THE FUTURE OF SERVICE OPERATIONS
                  </p>

                  {/* Headline */}
                  <h1 className="ae-page-hero__title">
                    ENGINEERED<br />
                    TO{" "}
                    <span className="ae-page-hero__title-accent">SCALE.</span>
                  </h1>

                  {/* Sub */}
                  <p className="ae-page-hero__sub">
                    The only AI-driven growth engine that handles your phones, your calendar,
                    and your follow-ups — with 100% precision.{" "}
                    <strong className="ae-page-hero__sub-em">Stop managing. Start Ascending.</strong>
                  </p>

                  {/* Mini stats */}
                  <div className="ae-page-hero__stats">
                    <div className="ae-page-hero__stat">
                      <i className="ph-bold ph-lightning ae-page-hero__stat-icon" />
                      <div>
                        <span className="ae-page-hero__stat-num">6s</span>
                        <span className="ae-page-hero__stat-label">Response Time</span>
                      </div>
                    </div>
                    <div className="ae-page-hero__stat-divider" />
                    <div className="ae-page-hero__stat">
                      <i className="ph-bold ph-robot ae-page-hero__stat-icon" />
                      <div>
                        <span className="ae-page-hero__stat-num">24/7</span>
                        <span className="ae-page-hero__stat-label">AI Reception</span>
                      </div>
                    </div>
                    <div className="ae-page-hero__stat-divider" />
                    <div className="ae-page-hero__stat">
                      <i className="ph-bold ph-trend-up ae-page-hero__stat-icon" />
                      <div>
                        <span className="ae-page-hero__stat-num">+30%</span>
                        <span className="ae-page-hero__stat-label">Capture Rate</span>
                      </div>
                    </div>
                  </div>

                  {/* CTAs */}
                  <div className="ae-page-hero__cta">
                    <AnimatedButton
                      as="button"
                      text="Activate the Engine"
                      className="btn btn-anim btn-default btn-additional slide-right-up"
                      onClick={() => openModal()}
                    >
                      <i className="ph-bold ph-arrow-up-right" />
                    </AnimatedButton>
                    <AnimatedButton
                      text="See It In Action"
                      className="btn btn-anim btn-default ae-cta-ghost slide-right-up"
                      href="/ascend-engine/simulation"
                    >
                      <i className="ph-bold ph-play" />
                    </AnimatedButton>
                  </div>

                  {/* Trust badge */}
                  <p className="ae-page-hero__trust">
                    <i className="ph-bold ph-users" />
                    <span>500+ CONTRACTORS SAVING 20+ HOURS/WEEK</span>
                  </p>

                </div>
              </div>

              {/* Right — 40% — Engine Panel */}
              <div className="col-12 col-xl-5 mxd-grid-item no-margin">
                <div className="ae-page-hero__right">
                  <div className="ae-engine-panel">
                    <div className="ae-engine-panel__header">
                      <div className="ae-hero-orb">
                        <div className="ae-hero-orb__ring ae-hero-orb__ring--3" />
                        <div className="ae-hero-orb__ring ae-hero-orb__ring--2" />
                        <div className="ae-hero-orb__ring ae-hero-orb__ring--1" />
                        <div className="ae-hero-orb__core">
                          <i className="ph-bold ph-lightning ae-hero-orb__icon" />
                        </div>
                      </div>
                      <div className="ae-engine-panel__header-text">
                        <p className="ae-engine-panel__name">Ascend Engine</p>
                        <p className="ae-engine-panel__status">
                          <span className="ae-engine-panel__status-dot" />
                          All systems operational
                        </p>
                      </div>
                    </div>
                    <FeedTicker />
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Live ticker bar */}
      <div className="ae-page-hero__ticker-bar">
        <div className="ae-page-hero__ticker-track">
          {doubled.map((text, i) => (
            <span key={i} className="ae-page-hero__ticker-item">
              <span className="ae-page-hero__ticker-live">[LIVE]</span>
              {text}
              <span className="ae-page-hero__ticker-sep">//</span>
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
