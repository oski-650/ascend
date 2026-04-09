import { Fragment } from "react";

const DISPATCH_JOBS = [
  { label: "Emergency HVAC — San Jose", priority: "HIGH MARGIN", active: true },
  { label: "Roof Inspection — Oakland", priority: "SCHEDULED", active: false },
  { label: "Quote Follow-up — Fresno", priority: "QUEUED", active: false },
];

const TIMELINE_STEPS = [
  { label: "Quote Sent", icon: "ph-file-text", accent: false },
  { label: "24hr SMS Nudge", icon: "ph-chat-dots", accent: false },
  { label: "48hr Voice Call", icon: "ph-phone-call", accent: false },
  { label: "Job Won", icon: "ph-check-circle", accent: true },
];

const WAVE_COUNT = 18;

export default function Architecture() {
  const waveBars = Array.from({ length: WAVE_COUNT }, (_, i) => i);

  return (
    <section className="ae-arch" id="engine">
      <div className="mxd-container">
        <div className="mxd-block">

          {/* Section Header */}
          <div className="ae-arch__header">
            <p className="ae-arch__eyebrow">
              <span className="ae-arch__eyebrow-dot" />
              TRIPLE-THREAT ARCHITECTURE
            </p>
            <h2 className="ae-arch__title">
              The Engine&apos;s<br />
              <span className="ae-arch__title-accent">Three Systems</span>
            </h2>
            <p className="ae-arch__sub">
              Three autonomous systems. One integrated stack. Built to convert leads,
              optimize routes, and close jobs — without human intervention.
            </p>
          </div>

          {/* Bento Grid */}
          <div className="ae-arch__grid">

            {/* ── Card 1: Neural Intake (wide — 2/3) ── */}
            <div className="ae-arch__card ae-arch__card--wide">
              <div className="ae-arch__card-inner ae-arch__card-inner--row ae-arch__card-inner--stretch">

                {/* Left: content */}
                <div className="ae-arch__content ae-arch__content--half ae-arch__content--intake">
                  <p className="ae-arch__num">01</p>
                  <h3 className="ae-arch__headline">THE NEURAL INTAKE</h3>
                  <p className="ae-arch__sub-headline">Instant Response. Zero Friction.</p>
                  <p className="ae-arch__copy">
                    Not just a chatbot. This is a <strong>high-fidelity AI Voice &amp; SMS agent</strong> that
                    mimics your <strong>top-performing office manager.</strong> Using advanced semantic
                    understanding, it instantly distinguishes between a routine quote request and a{" "}
                    <strong>midnight emergency.</strong>
                  </p>
                </div>

                {/* Right: terminal panel */}
                <div className="ae-arch__visual ae-arch__visual--intake">
                  <div className="ae-arch__intake-panel">

                    {/* Panel chrome header */}
                    <div className="ae-arch__intake-chrome">
                      <span className="ae-arch__chrome-dot ae-arch__chrome-dot--red" />
                      <span className="ae-arch__chrome-dot ae-arch__chrome-dot--yellow" />
                      <span className="ae-arch__chrome-dot ae-arch__chrome-dot--green" />
                      <span className="ae-arch__intake-chrome-label">voice_intake.ai</span>
                    </div>

                    {/* Waveform */}
                    <div className="ae-arch__wave ae-arch__wave--tall" aria-hidden="true">
                      {waveBars.map((i) => (
                        <div
                          key={i}
                          className="ae-arch__wave-bar"
                          style={{ animationDelay: `${(i * 0.07).toFixed(2)}s` }}
                        />
                      ))}
                    </div>
                    <div className="ae-arch__wave-label">
                      <span className="ae-arch__wave-dot" />
                      VOICE SIGNAL ACTIVE
                    </div>

                    {/* Live mini-stats */}
                    <div className="ae-arch__intake-stats">
                      <div className="ae-arch__intake-stat">
                        <span className="ae-arch__intake-stat-num">6s</span>
                        <span className="ae-arch__intake-stat-label">Avg Response</span>
                      </div>
                      <div className="ae-arch__intake-stat-divider" />
                      <div className="ae-arch__intake-stat">
                        <span className="ae-arch__intake-stat-num">100%</span>
                        <span className="ae-arch__intake-stat-label">Uptime</span>
                      </div>
                      <div className="ae-arch__intake-stat-divider" />
                      <div className="ae-arch__intake-stat">
                        <span className="ae-arch__intake-stat-num">24/7</span>
                        <span className="ae-arch__intake-stat-label">Coverage</span>
                      </div>
                    </div>

                  </div>
                </div>

              </div>

              {/* Tags — bottom left, inline with status bar */}
              <div className="ae-arch__tags ae-arch__tags--bottom">
                <span className="ae-arch__tag">NLP Intent Detection</span>
                <span className="ae-arch__tag">24/7 Voice/SMS</span>
              </div>

              {/* Status */}
              <div className="ae-arch__status-bar">
                <span className="ae-arch__status-dot" />
                <span className="ae-arch__status-text">INTAKE: ACTIVE</span>
              </div>
            </div>

            {/* ── Card 2: Logic Gate (square — 1/3) ── */}
            <div className="ae-arch__card ae-arch__card--square">
              <div className="ae-arch__card-inner">

                {/* Dispatch visual */}
                <div className="ae-arch__visual ae-arch__visual--dispatch">
                  {DISPATCH_JOBS.map((job, i) => (
                    <div
                      key={i}
                      className={`ae-arch__dispatch-row${job.active ? " ae-arch__dispatch-row--active" : ""}`}
                    >
                      <span className="ae-arch__dispatch-dot" />
                      <div className="ae-arch__dispatch-info">
                        <span className="ae-arch__dispatch-label">{job.label}</span>
                        <span className="ae-arch__dispatch-priority">{job.priority}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Content */}
                <div className="ae-arch__content">
                  <p className="ae-arch__num">02</p>
                  <h3 className="ae-arch__headline">THE LOGIC GATE</h3>
                  <p className="ae-arch__sub-headline">Profit-First Scheduling.</p>
                  <p className="ae-arch__copy">
                    It doesn&apos;t just fill your calendar; it <strong>optimizes it.</strong> The Engine
                    analyzes <strong>GPS data and job complexity</strong> to slash windshield time and
                    prioritize the <strong>highest-margin jobs first.</strong>
                  </p>
                  <div className="ae-arch__tags">
                    <span className="ae-arch__tag">GPS Route Optimization</span>
                    <span className="ae-arch__tag">Profitability Logic</span>
                  </div>
                </div>
              </div>

              {/* Status */}
              <div className="ae-arch__status-bar">
                <span className="ae-arch__status-dot" />
                <span className="ae-arch__status-text">STATUS: OPTIMIZING</span>
              </div>
            </div>

            {/* ── Card 3: Velocity Loop (full — 3/3) ── */}
            <div className="ae-arch__card ae-arch__card--full">
              <div className="ae-arch__card-inner ae-arch__card-inner--row">

                {/* Content */}
                <div className="ae-arch__content ae-arch__content--third">
                  <p className="ae-arch__num">03</p>
                  <h3 className="ae-arch__headline">THE VELOCITY LOOP</h3>
                  <p className="ae-arch__sub-headline">The Relentless Close.</p>
                  <p className="ae-arch__copy">
                    <strong>Most jobs are lost in the follow-up.</strong> The Velocity Loop automates the
                    chase. If a quote isn&apos;t signed within <strong>24 hours,</strong> the Engine initiates
                    a <strong>multi-channel nudge sequence</strong> — SMS, Email, and Voice — stopping only
                    when the <strong>contract is secured.</strong>
                  </p>
                  <div className="ae-arch__tags">
                    <span className="ae-arch__tag">Multi-Channel Persuasion</span>
                    <span className="ae-arch__tag">Autonomous Closing</span>
                  </div>
                </div>

                {/* Timeline visual */}
                <div className="ae-arch__visual ae-arch__visual--timeline">
                  {TIMELINE_STEPS.map((step, i) => (
                    <Fragment key={i}>
                      <div className={`ae-arch__timeline-step${step.accent ? " ae-arch__timeline-step--win" : ""}`}>
                        <div className="ae-arch__timeline-icon">
                          <i className={`ph-bold ${step.icon}`} />
                        </div>
                        <span className="ae-arch__timeline-label">{step.label}</span>
                      </div>
                      {i < TIMELINE_STEPS.length - 1 && (
                        <div className="ae-arch__timeline-conn" aria-hidden="true">
                          <i className="ph-bold ph-arrow-right" />
                        </div>
                      )}
                    </Fragment>
                  ))}
                </div>

              </div>

              {/* Status */}
              <div className="ae-arch__status-bar">
                <span className="ae-arch__status-dot" />
                <span className="ae-arch__status-text">CLOSING RATIO: MAXIMIZED</span>
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  );
}
