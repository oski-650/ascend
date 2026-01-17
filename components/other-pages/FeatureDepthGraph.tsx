type TierKey = "starter" | "growth" | "pro";

interface FeatureRow {
  label: string;
  values: Record<TierKey, number>; // 0–4
  maxDots: Record<TierKey, number>; // max dots per tier
}

const FEATURES: FeatureRow[] = [
  {
    label: "Website Structure",
    values: { starter: 2, growth: 3, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
  {
    label: "Design Quality",
    values: { starter: 2, growth: 3, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
  {
    label: "Performance",
    values: { starter: 2, growth: 3, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
  {
    label: "SEO",
    values: { starter: 1, growth: 3, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
  {
    label: "Analytics & Tracking",
    values: { starter: 0, growth: 3, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
  {
    label: "Strategy & Support",
    values: { starter: 0, growth: 2, pro: 4 },
    maxDots: { starter: 3, growth: 3, pro: 4 },
  },
];

function Dots({ count, max }: { count: number; max: number }) {
  return (
    <div className="depth-dots">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`dot ${i < count ? "dot--active" : ""}`}
        />
      ))}
    </div>
  );
}

export default function FeatureDepthGraph() {
  return (
    <div className="mxd-block mxd-feature-depth">
      {/* <h3 className="t-large t-bright mb-4">
        Compare execution depth
      </h3> */}

      <div className="feature-depth-table">
        <div className="feature-depth-header">
          <span />
          <span>Starter</span>
          <span>Growth</span>
          <span>Ascend Pro</span>
        </div>

        {FEATURES.map((row) => (
          <div key={row.label} className="feature-depth-row">
            <span className="feature-label">{row.label}</span>
            <Dots count={row.values.starter} max={row.maxDots.starter} />
            <Dots count={row.values.growth} max={row.maxDots.growth} />
            <Dots count={row.values.pro} max={row.maxDots.pro} />
          </div>
        ))}
      </div>
    </div>
  );
}