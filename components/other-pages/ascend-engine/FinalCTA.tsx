"use client";

import { useEngineModal } from "./EngineModalContext";

const TRUST_ITEMS = [
  { icon: "ph-lightning",    text: "6-Second Response Time" },
  { icon: "ph-clock",        text: "24/7 — Never Off the Clock" },
  { icon: "ph-shield-check", text: "One Operator Per Territory" },
  { icon: "ph-trend-up",     text: "Avg. +30% Revenue Captured" },
];

export default function FinalCTA() {
  const { openModal } = useEngineModal();

  return (
    <section className="ae-final">

      {/* Radial glow backdrop */}
      <div className="ae-final__glow" aria-hidden="true" />

      {/* Grid overlay */}
      <div className="ae-final__grid" aria-hidden="true" />

      <div className="mxd-container">
        <div className="ae-final__inner">

          {/* Eyebrow */}
          <p className="ae-final__eyebrow">
            <span className="ae-final__eyebrow-dot" />
            THE WINDOW IS CLOSING
          </p>

          {/* Headline */}
          <h2 className="ae-final__title">
            Your Competitors Are<br />
            <span className="ae-final__title-accent">Already Automating.</span>
          </h2>

          {/* Sub */}
          <p className="ae-final__sub">
            Every day without the Engine is another day of missed calls, lost leads,
            and revenue handed to the contractor who picked up the phone.
          </p>

          {/* CTA */}
          <button
            type="button"
            className="ae-final__btn"
            onClick={() => openModal()}
          >
            ACTIVATE THE ENGINE
          </button>

          {/* Trust items */}
          <div className="ae-final__trust">
            {TRUST_ITEMS.map((item, i) => (
              <div key={i} className="ae-final__trust-item">
                <i className={`ph-bold ${item.icon} ae-final__trust-icon`} />
                <span>{item.text}</span>
              </div>
            ))}
          </div>

        </div>
      </div>

    </section>
  );
}
