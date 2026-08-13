import type { Metadata } from "next";
import "./globals.css";
import { StopwatchWidget } from "@/components/StopwatchWidget";
import { OrbitalDock } from "@/components/OrbitalDock";
import { TopMetricStrip } from "@/components/TopMetricStrip";
import { CommandPalette } from "@/components/CommandPalette";
import { JarvisLauncher } from "@/components/JarvisLauncher";
import { listClients } from "@/lib/vault";
import { detectFirings } from "@/lib/automations";

export const metadata: Metadata = {
  title: "Ascend OS",
  description: "Agency command center · Phase 1",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Server-render the top-strip values from real state.
  let activeClientCount = 0;
  let pendingSignals = 0;
  try {
    const [clients, firings] = await Promise.all([listClients(), detectFirings()]);
    activeClientCount = clients.length;
    pendingSignals = firings.pending.length;
  } catch {
    /* leave defaults */
  }

  return (
    <html lang="en">
      <body className="min-h-screen hud-aurora">
        <div className="hud-grid pointer-events-none fixed inset-0 z-0" aria-hidden />
        <OrbitalDock />
        <TopMetricStrip
          activeClientCount={activeClientCount}
          pendingSignals={pendingSignals}
        />
        <main className="relative z-10 mx-auto max-w-7xl px-4 pb-28 pt-16 sm:pl-20 sm:pr-6 sm:pb-20">
          {children}
        </main>
        <StopwatchWidget />
        <CommandPalette />
        <JarvisLauncher />
      </body>
    </html>
  );
}
