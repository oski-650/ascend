export function ScoreSparkline({
  values,
  width = 96,
  height = 24,
  color = "var(--color-accent)",
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const clean = values.map((v) => (v === null ? null : Math.max(0, Math.min(100, v))));
  if (clean.length === 0 || clean.every((v) => v === null)) {
    return <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">no data</span>;
  }
  const n = clean.length;
  const step = n > 1 ? width / (n - 1) : 0;

  // Build polyline points (treat null as gap by splitting into segments)
  const segments: string[] = [];
  let current: string[] = [];
  clean.forEach((v, i) => {
    if (v === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    const x = i * step;
    const y = height - (v / 100) * height;
    current.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {segments.map((pts, i) => (
        <polyline
          key={i}
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
      {/* Last value dot */}
      {clean[n - 1] !== null && (
        <circle
          cx={((n - 1) * step).toFixed(1)}
          cy={(height - ((clean[n - 1] as number) / 100) * height).toFixed(1)}
          r={2}
          fill={color}
        />
      )}
    </svg>
  );
}
