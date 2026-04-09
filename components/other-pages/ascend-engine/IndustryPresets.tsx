"use client";

import { useState } from "react";
import Link from "next/link";

type SmsMsg = { from: "lead" | "engine"; text: string };

interface Industry {
  id: string;
  icon: string;
  label: string;
  preset: string;
  tag: string;
  hook: string;
  logic: string;
  metric: string;
  metricLabel: string;
  saving: string;
  savingLabel: string;
  sms: SmsMsg[];
  ctaLabel: string;
}

const INDUSTRIES: Industry[] = [
  {
    id: "hvac",
    icon: "ph-fire",
    label: "HVAC & Plumbing",
    preset: "THE EMERGENCY DISPATCHER",
    tag: "EMERGENCY_PRIORITY_ON",
    hook: 'Stop losing "No Heat" calls to the guy who answers the phone at 2 AM.',
    logic:
      'Scans for critical keywords like "Flood" or "No Heat," then auto-calculates travel time vs. technician proximity to dispatch the most profitable job instantly.',
    metric: "+28%",
    metricLabel: "After-Hours Revenue Captured",
    saving: "14 HRS/WK",
    savingLabel: "Saved on Manual Dispatching",
    sms: [
      { from: "lead", text: "My heat is out, it's freezing in here" },
      { from: "engine", text: "Emergency detected. Nearest tech 4.2mi. ETA 22 min — confirm?" },
      { from: "lead", text: "Yes please!" },
      { from: "engine", text: "✓ Booked. Tech en route. SMS updates incoming." },
    ],
    ctaLabel: "DEPLOY HVAC ENGINE",
  },
  {
    id: "realestate",
    icon: "ph-buildings",
    label: "Real Estate & Solar",
    preset: "THE INFINITE NURTURE",
    tag: "LONG_TAIL_PERSUASION",
    hook: "Stop the Lead Bleed. 80% of leads need 5+ follow-ups — most agents stop at one.",
    logic:
      "Persistent multi-channel persuasion. The Engine nurtures cold leads via SMS & Voice for up to 6 months, alerting you only when they are ready to sign.",
    metric: "5×",
    metricLabel: "More Leads Converted to Appointments",
    saving: "20 HRS/WK",
    savingLabel: "Saved on Lead Nurturing",
    sms: [
      { from: "lead", text: "Interested in the Maple Ave listing" },
      { from: "engine", text: "Great! Want to schedule a viewing this week?" },
      { from: "lead", text: "Maybe next month..." },
      { from: "engine", text: "[31 days] Ready for Maple Ave? 3 buyers toured it this week." },
    ],
    ctaLabel: "DEPLOY REAL ESTATE ENGINE",
  },
  {
    id: "landscaping",
    icon: "ph-plant",
    label: "Landscaping & Cleaning",
    preset: "THE ROUTE OPTIMIZER",
    tag: "ROUTE_DENSITY_MAX",
    hook: "Slash your Windshield Time. Non-billable driving is profit you're handing back.",
    logic:
      "Analyzes job locations and clusters same-zip bookings to maximize your crew's billable hours per day — no more cross-town chaos or empty miles.",
    metric: "+40%",
    metricLabel: "Billable Hours Per Crew / Day",
    saving: "18 HRS/WK",
    savingLabel: "Saved on Scheduling & Routing",
    sms: [
      { from: "lead", text: "Need weekly lawn care — 3BR house in Sunnyvale" },
      { from: "engine", text: "Your address is on an existing Thursday route. Want in?" },
      { from: "lead", text: "Perfect!" },
      { from: "engine", text: "✓ Added to Thursday crew. First visit next week." },
    ],
    ctaLabel: "DEPLOY LANDSCAPING ENGINE",
  },
  {
    id: "contractor",
    icon: "ph-hard-hat",
    label: "General Contractors",
    preset: "THE PROJECT COMMAND CENTER",
    tag: "CHANGE_ORDER_AUTOMATION",
    hook: "Stop chasing signatures and losing margin on undocumented changes.",
    logic:
      "Detects change order requests in any message, auto-drafts a priced CO, sends it for e-signature, updates the project total, regenerates the invoice, and logs the audit trail — all without lifting a finger.",
    metric: "+$4,800",
    metricLabel: "Avg. Change Order Captured Per Job",
    saving: "12 HRS/WK",
    savingLabel: "Saved on Admin & Documentation",
    sms: [
      { from: "lead", text: "Can we add recessed lighting to the master bedroom?" },
      { from: "engine", text: "CO-003 drafted: Recessed Lighting — Master. $4,800 added. Sending for signature." },
      { from: "lead", text: "Signed!" },
      { from: "engine", text: "✓ Approved. Project total updated to $87,200. Invoice regenerated." },
    ],
    ctaLabel: "DEPLOY CONTRACTOR ENGINE",
  },
];

export default function IndustryPresets() {
  const [active, setActive] = useState(0);
  const [scanning, setScanning] = useState(false);

  const handleSwitch = (i: number) => {
    if (i === active || scanning) return;
    setScanning(true);
    setTimeout(() => {
      setActive(i);
      setScanning(false);
    }, 300);
  };

  const ind = INDUSTRIES[active];

  return (
    <section className="ae-presets" id="ae-presets">
      <div className="mxd-container">
        <div className="mxd-block">

          {/* Section Header */}
          <div className="ae-presets__header">
            <p className="ae-presets__eyebrow">
              <span className="ae-presets__eyebrow-dot" />
              INDUSTRY PRESETS
            </p>
            <h2 className="ae-presets__title">
              Built For<br />
              <span className="ae-presets__title-accent">Your Trade</span>
            </h2>
            <p className="ae-presets__sub">
              Not a generic tool. The Engine ships with <strong>pre-trained logic</strong> for your
              specific industry — tuned to your customers, your calendar, and your margins.
            </p>
          </div>

          {/* Simulator Layout */}
          <div className="ae-presets__layout">

            {/* Left: Vertical tab switcher */}
            <div className="ae-presets__switcher">
              {INDUSTRIES.map((industry, i) => (
                <button
                  key={industry.id}
                  type="button"
                  className={`ae-presets__tab${active === i ? " ae-presets__tab--active" : ""}`}
                  onClick={() => handleSwitch(i)}
                >
                  <span className="ae-presets__tab-icon">
                    <i className={`ph-bold ${industry.icon}`} />
                  </span>
                  <div className="ae-presets__tab-text">
                    <span className="ae-presets__tab-label">{industry.label}</span>
                    <span className="ae-presets__tab-preset">{industry.preset}</span>
                  </div>
                  <i className="ph-bold ph-caret-right ae-presets__tab-arrow" />
                </button>
              ))}

              <div className="ae-presets__engine-status">
                <span className="ae-presets__engine-dot" />
                <span className="ae-presets__engine-label">ENGINE ONLINE — {INDUSTRIES.length} PRESETS LOADED</span>
              </div>
            </div>

            {/* Right: Dynamic panel */}
            <div className="ae-presets__panel">
              {/* Blueprint grid backdrop */}
              <div className="ae-presets__panel-grid" aria-hidden="true" />

              {/* Panel content — fades during transition */}
              <div className={`ae-presets__panel-content${scanning ? " ae-presets__panel-content--hidden" : ""}`}>

                {/* Top bar */}
                <div className="ae-presets__panel-top">
                  <p className="ae-presets__panel-preset-name">{ind.preset}</p>
                  <span className="ae-presets__panel-tag">{ind.tag}</span>
                </div>

                {/* Body: left info + right phone */}
                <div className="ae-presets__panel-body">

                  {/* Left: hook + chip + metrics + CTA */}
                  <div className="ae-presets__panel-left">
                    <p className="ae-presets__hook">&ldquo;{ind.hook}&rdquo;</p>

                    <div className="ae-presets__chip">
                      <p className="ae-presets__chip-label">
                        <i className="ph-bold ph-cpu" />
                        AI LOGIC
                      </p>
                      <p className="ae-presets__chip-body">{ind.logic}</p>
                    </div>

                    <div className="ae-presets__metrics">
                      <div className="ae-presets__metric">
                        <span className="ae-presets__metric-num">{ind.metric}</span>
                        <span className="ae-presets__metric-label">{ind.metricLabel}</span>
                      </div>
                      <div className="ae-presets__metric-divider" />
                      <div className="ae-presets__metric">
                        <span className="ae-presets__metric-num ae-presets__metric-num--time">{ind.saving}</span>
                        <span className="ae-presets__metric-label">{ind.savingLabel}</span>
                      </div>
                    </div>

                    <Link
                      href={`/ascend-engine/simulation?preset=${ind.id}`}
                      className="ae-presets__deploy-btn"
                    >
                      {ind.ctaLabel}
                      <i className="ph-bold ph-arrow-up-right" />
                    </Link>
                  </div>

                  {/* Right: Phone mockup */}
                  <div className="ae-presets__panel-right">
                    <div className="ae-presets__phone">
                      <div className="ae-presets__phone-chrome">
                        <span className="ae-presets__phone-notch" />
                      </div>
                      <div className="ae-presets__phone-screen">
                        <div className="ae-presets__sms-header">
                          <span className="ae-presets__sms-avatar">
                            <i className="ph-bold ph-robot" />
                          </span>
                          <div>
                            <p className="ae-presets__sms-name">Ascend Engine</p>
                            <p className="ae-presets__sms-status">
                              <span className="ae-presets__sms-online-dot" />
                              online
                            </p>
                          </div>
                        </div>
                        <div className="ae-presets__sms-feed">
                          {ind.sms.map((msg, i) => (
                            <div
                              key={i}
                              className={`ae-presets__sms-bubble ae-presets__sms-bubble--${msg.from}`}
                            >
                              {msg.text}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>

              {/* Scanning overlay */}
              {scanning && (
                <div className="ae-presets__scan-overlay" aria-hidden="true">
                  <span className="ae-presets__scan-text">CALIBRATING PRESET...</span>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
