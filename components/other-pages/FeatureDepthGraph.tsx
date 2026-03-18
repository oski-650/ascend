"use client";

import { Fragment, useState } from "react";

type Tier = "starter" | "growth" | "pro";

interface FeatureRow {
  label: string;
  values: Record<Tier, number>;
}

const MAX_DOTS = 4;

const FEATURES: FeatureRow[] = [
  { label: "Visual Design",           values: { starter: 2, growth: 3, pro: 4 } },
  { label: "Speed & Performance",     values: { starter: 2, growth: 3, pro: 4 } },
  { label: "SEO Depth",               values: { starter: 1, growth: 3, pro: 4 } },
  { label: "Care & Maintenance",      values: { starter: 1, growth: 3, pro: 4 } },
  { label: "Conversion Optimization", values: { starter: 0, growth: 3, pro: 4 } },
  { label: "Analytics & Tracking",    values: { starter: 0, growth: 3, pro: 4 } },
  { label: "AI Automation",           values: { starter: 0, growth: 0, pro: 4 } },
];

const TIERS: {
  key: Tier;
  label: string;
  price: string;
  tag: string;
  tagClass: string;
}[] = [
  { key: "starter", label: "Starter",    price: "$1,257", tag: "Get Started",  tagClass: "tag-accent" },
  { key: "growth",  label: "Growth",     price: "$2,497", tag: "Most Popular", tagClass: "tag-additional" },
  { key: "pro",     label: "Ascend Pro", price: "$3,127", tag: "Scale",        tagClass: "tag-additional" },
];

function Dots({ count }: { count: number }) {
  return (
    <div className="fdc-dots">
      {Array.from({ length: MAX_DOTS }, (_, i) => (
        <span key={i} className={`fdc-dot${i < count ? " fdc-dot--active" : ""}`} />
      ))}
    </div>
  );
}

export default function FeatureDepthGraph() {
  const [hovered, setHovered] = useState<Tier | null>(null);

  const colClass = (tier: Tier) => hovered === tier ? " is-hover" : "";

  return (
    <div className="mxd-section padding-compare-table">
      <div className="mxd-container grid-container">
        <div className="mxd-block">

          {/* Single unified grid — header + all rows share the same column tracks */}
          <div className="fdc-scroll-wrap">
          <div className="fdc-table">

            {/* Header row */}
            <div className="fdc-spacer" />
            {TIERS.map((tier) => (
              <div
                key={tier.key}
                className={`fdc-header__plan${colClass(tier.key)}`}
                onMouseEnter={() => setHovered(tier.key)}
                onMouseLeave={() => setHovered(null)}
              >
                <p className="fdc-plan-name">{tier.label}</p>
                <p className="fdc-plan-price">{tier.price}</p>
              </div>
            ))}

            {/* Feature rows */}
            {FEATURES.map((row) => (
              <Fragment key={row.label}>
                <span className="fdc-row__label anim-uni-in-up">{row.label}</span>
                {TIERS.map((tier) => (
                  <div
                    key={tier.key}
                    className={`fdc-row__cell anim-uni-in-up${colClass(tier.key)}`}
                    onMouseEnter={() => setHovered(tier.key)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <Dots count={row.values[tier.key]} />
                  </div>
                ))}
              </Fragment>
            ))}

          </div>
          </div>

        </div>
      </div>
    </div>
  );
}
