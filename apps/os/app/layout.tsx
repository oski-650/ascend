import type { Metadata } from "next";
import { cookies } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { NavRail } from "@/components/shell/NavRail";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { StopwatchWidget } from "@/components/StopwatchWidget";
import { SESSION_COOKIE, readAuthConfig, verifySessionToken } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Ascend OS",
  description: "The operating system for the business",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The operator shell (nav, palette, stopwatch) renders ONLY for an authenticated operator.
  // Unchanged from the previous layout, and load-bearing for security rather than presentation:
  // nested layouts render INSIDE this one, so an ungated shell would leak internal navigation onto
  // the public client portal and the login page. See app/portal/layout.tsx.
  const cookieStore = await cookies();
  const isOperator = await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value, readAuthConfig());

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-t1)]">
        {isOperator ? (
          <div className="flex h-screen w-full overflow-hidden">
            <NavRail />
            <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
            <CommandPalette />
            <StopwatchWidget />
          </div>
        ) : (
          <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{children}</main>
        )}
      </body>
    </html>
  );
}