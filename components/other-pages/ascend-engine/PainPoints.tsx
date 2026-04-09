const PAIN_CARDS = [
  {
    icon: "ph-phone-slash",
    stat: "4.2 HRS",
    statLabel: "Avg. Response Time",
    headline: "The 5-Minute Death Zone",
    body: (
      <>
        If you don't answer a new lead within <strong>5 minutes</strong>, your odds of closing drop by{" "}
        <strong>400%</strong>. While you're on a job, your competitors are{" "}
        <strong>picking up your next one.</strong>
      </>
    ),
    tag: "SPEED TO LEAD",
  },
  {
    icon: "ph-clock-countdown",
    stat: "15+ HRS",
    statLabel: "Lost Per Week",
    headline: "The Admin Tax",
    body: (
      <>
        Chasing quotes, playing phone tag, and sending invoice reminders{" "}
        <strong>every Sunday night</strong> isn't running a business — it's{" "}
        <strong>a second job you're not getting paid for.</strong>
      </>
    ),
    tag: "TIME DRAIN",
  },
  {
    icon: "ph-phone-x",
    stat: "60%",
    statLabel: "Calls Go Unanswered",
    headline: "Voicemails Don't Pay Bills",
    body: (
      <>
        <strong>80% of callers</strong> won't leave a message. They hang up and call the next listing on
        Google. Every missed call is a <strong>$1,000+ donation</strong> to the contractor down the street.
      </>
    ),
    tag: "REVENUE LEAK",
  },
];

export default function PainPoints() {
  return (
    <section className="ae-pain">
      <div className="mxd-container">
        <div className="mxd-block">

          {/* Section header */}
          <div className="ae-pain__header">
            <p className="ae-pain__eyebrow">
              <span className="ae-pain__eyebrow-dot" />
              THE COST OF HUMAN LIMITS
            </p>
            <h2 className="ae-pain__title">
              Is Your Business<br />
              <span className="ae-pain__title-accent">Running You?</span>
            </h2>
            <p className="ae-pain__sub">
              Traditional service businesses leak <strong>20–30% of potential revenue</strong> through
              manual gaps. Not from lack of effort — from lack of infrastructure.
            </p>
          </div>

          {/* Cards grid */}
          <div className="container-fluid px-0">
            <div className="row gx-4 gy-4">
              {PAIN_CARDS.map((card, i) => (
                <div key={i} className="col-12 col-md-6 col-xl-4">
                  <div className="ae-pain__card">
                    <div className="ae-pain__card-top">
                      <div className="ae-pain__card-icon">
                        <i className={`ph-bold ${card.icon}`} />
                      </div>
                      <span className="ae-pain__card-tag">{card.tag}</span>
                    </div>
                    <div className="ae-pain__card-stat">
                      <span className="ae-pain__card-stat-num">{card.stat}</span>
                      <span className="ae-pain__card-stat-label">{card.statLabel}</span>
                    </div>
                    <h3 className="ae-pain__card-headline">{card.headline}</h3>
                    <p className="ae-pain__card-body">{card.body}</p>
                    <div className="ae-pain__card-bar" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pivot bridge */}
          <div className="ae-pain__pivot">
            <p className="ae-pain__pivot-quote">
              "You don't need more hours in the day.<br />
              You need a system that doesn't sleep."
            </p>
            <a href="/ascend-engine/simulation" className="ae-pain__pivot-link">
              Discover the Engine
              <i className="ph-bold ph-arrow-right" />
            </a>
          </div>

        </div>
      </div>
    </section>
  );
}
