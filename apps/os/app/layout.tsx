import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { StopwatchWidget } from "@/components/StopwatchWidget";
import { OrbitalDock } from "@/components/OrbitalDock";
import { TopMetricStrip } from "@/components/TopMetricStrip";
import { CommandPalette } from "@/components/CommandPalette";
import { JarvisLauncher } from "@/components/JarvisLauncher";
import { listClients } from "@/lib/vault";
import { detectFirings } from "@/lib/automations";
import { SESSION_COOKIE, readAuthConfig, verifySessionToken } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Ascend OS",
  description: "Agency command center · Phase 1",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The operator HUD (dock, metric strip, stopwatch, palette, JARVIS) is rendered ONLY for an
  // authenticated operator. Two reasons, both security rather than presentation:
  //   1. The metric strip exposes real business counts (active clients, pending signals). Because
  //      nested layouts render INSIDE this one, those counts were previously visible on the public
  //      client portal and would have been visible on the login page.
  //   2. It avoids two vault reads (listClients + detectFirings) on every unauthenticated request.
  // This also finally delivers what app/portal/layout.tsx already documents about itself:
  // "Public-facing layout — no internal HUD nav/widgets."
  const cookieStore = await cookies();
  const isOperator = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value, readAuthConfig());

  let activeClientCount = 0;
  let pendingSignals = 0;
  if (isOperator) {
    try {
      const [clients, firings] = await Promise.all([listClients(), detectFirings()]);
      activeClientCount = clients.length;
      pendingSignals = firings.pending.length;
    } catch {
      /* leave defaults */
    }
  }

  return (
    <html lang="en">
      <body className="min-h-screen hud-aurora">
        <div className="hud-grid pointer-events-none fixed inset-0 z-0" aria-hidden />
        {isOperator && (
          <>
            <OrbitalDock />
            <TopMetricStrip activeClientCount={activeClientCount} pendingSignals={pendingSignals} />
          </>
        )}
        <main
          className={
            isOperator
              ? "relative z-10 mx-auto max-w-7xl px-4 pb-28 pt-16 sm:pl-20 sm:pr-6 sm:pb-20"
              : "relative z-10 mx-auto max-w-7xl px-4 pb-12 pt-10 sm:px-6"
          }
        >
          {children}
        </main>
        {isOperator && (
          <>
            <StopwatchWidget />
            <CommandPalette />
            <JarvisLauncher />
          </>
        )}
      </body>
    </html>
  );
}