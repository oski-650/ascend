"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Wifi, Users, Clock } from "lucide-react";

type Props = {
  activeClientCount: number;
  pendingSignals: number;
};

export function TopMetricStrip({ activeClientCount, pendingSignals }: Props) {
  const [now, setNow] = useState<Date | null>(null);
  const [uptime, setUptime] = useState<"online" | "checking" | "offline">("checking");

  // Live clock — only render after mount to avoid hydration mismatch. The first tick is scheduled
  // rather than set synchronously: a synchronous setState inside an effect triggers a cascading
  // re-render (react-hooks/set-state-in-effect).
  useEffect(() => {
    const seed = setTimeout(() => setNow(new Date()), 0);
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearTimeout(seed);
      clearInterval(i);
    };
  }, []);

  // "API uptime" check — pings /api/time/active (cheapest read endpoint we have)
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        const r = await fetch("/api/time/active", { cache: "no-store" });
        if (!cancelled) setUptime(r.ok ? "online" : "offline");
      } catch {
        if (!cancelled) setUptime("offline");
      }
    }
    ping();
    const i = setInterval(ping, 15_000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, []);

  const timeStr = now
    ? now.toLocaleTimeString("en-US", { hour12: false }) + " " +
      now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
    : "--:--:--";

  return (
    <header className="fixed inset-x-0 top-0 z-40 h-12 border-b border-zinc-800/50 bg-zinc-950/60 backdrop-blur-lg sm:pl-14">
      <div className="flex h-full items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: wordmark */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.2em] text-[var(--color-accent)]">ASCEND</span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-zinc-500">·</span>
          <span className="hidden font-mono text-[10px] tracking-[0.2em] text-zinc-400 sm:inline">OS</span>
          <span className="ml-2 hidden font-mono text-[9px] text-zinc-600 sm:inline">v0.1 · phase 1</span>
        </div>

        {/* Right: live telemetry */}
        <div className="flex items-center gap-2 sm:gap-4">
          <Metric icon={Wifi} label="API">
            <span
              className={`inline-block size-1.5 rounded-full ${
                uptime === "online"
                  ? "bg-[var(--color-success)] shadow-[0_0_6px_var(--color-success)] hud-pulse"
                  : uptime === "checking"
                    ? "bg-zinc-500"
                    : "bg-[var(--color-danger)] shadow-[0_0_6px_var(--color-danger)]"
              }`}
            />
            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-300">
              {uptime}
            </span>
          </Metric>

          <Metric icon={Users} label="Clients">
            <Ticker value={activeClientCount} />
          </Metric>

          <Metric icon={Activity} label="Signals" highlight={pendingSignals > 0}>
            <Ticker value={pendingSignals} accent={pendingSignals > 0 ? "system" : undefined} />
          </Metric>

          <Metric icon={Clock} label="Local">
            <span className="font-mono text-[10px] tabular-nums text-zinc-300">{timeStr}</span>
          </Metric>
        </div>
      </div>
    </header>
  );
}

function Metric({
  icon: Icon,
  label,
  children,
  highlight,
}: {
  icon: typeof Activity;
  label: string;
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-zinc-800/50 bg-zinc-950/40 px-2 py-1 backdrop-blur">
      <Icon
        className={`size-3 ${highlight ? "text-[var(--color-system)]" : "text-zinc-500"}`}
        strokeWidth={1.6}
      />
      <span className="hidden font-mono text-[9px] uppercase tracking-widest text-zinc-500 sm:inline">
        {label}
      </span>
      <span className="flex items-center">{children}</span>
    </div>
  );
}

function Ticker({ value, accent }: { value: number; accent?: "system" | "accent" }) {
  // Spring-animate value updates so the count "ticks" rather than snapping.
  const color =
    accent === "system"
      ? "text-[var(--color-system)]"
      : accent === "accent"
        ? "text-[var(--color-accent)]"
        : "text-zinc-300";
  return (
    <motion.span
      key={value}
      initial={{ opacity: 0.2, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className={`font-mono text-xs font-semibold tabular-nums ${color}`}
    >
      {value}
    </motion.span>
  );
}
