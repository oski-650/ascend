"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  Users,
  Target,
  Workflow,
  ListChecks,
  FileText,
  Radar,
  Zap,
  Wrench,
  DollarSign,
  MessageSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";

type DockItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  live: boolean;
  system?: boolean;
};

const DOCK: DockItem[] = [
  { label: "Mission", href: "/dashboard", icon: Activity, live: true },
  { label: "CRM", href: "/crm", icon: Users, live: true },
  { label: "Hit List", href: "/sales", icon: Target, live: true },
  { label: "Production", href: "/production", icon: Workflow, live: true },
  { label: "Tasks", href: "/tasks", icon: ListChecks, live: true },
  { label: "Docs", href: "/documents", icon: FileText, live: true },
  { label: "Signals", href: "/signals", icon: Radar, live: true },
  { label: "Automations", href: "/automations", icon: Zap, live: true },
  { label: "Maintenance", href: "/maintenance", icon: Wrench, live: true },
  { label: "Finance", href: "/finance", icon: DollarSign, live: true },
  { label: "Comms", href: "/crm", icon: MessageSquare, live: false },
  { label: "Admin", href: "/admin", icon: Settings, live: true, system: true },
];

export function OrbitalDock() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Module dock"
      className="fixed inset-y-0 left-0 z-50 hidden w-14 flex-col items-center border-r border-zinc-800/50 bg-zinc-950/40 py-3 backdrop-blur-lg sm:flex"
    >
      <Link
        href="/dashboard"
        aria-label="Ascend OS · Home"
        className="mb-4 flex size-9 items-center justify-center rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 shadow-[0_0_18px_-4px_var(--color-accent)]"
      >
        <span className="block size-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]" />
      </Link>

      <ul className="flex w-full flex-1 flex-col items-center gap-1">
        {DOCK.map((item) => {
          const active =
            item.href !== "/" &&
            (pathname === item.href || pathname.startsWith(item.href + "/"));
          const Icon = item.icon;
          const accent = item.system
            ? "text-[var(--color-system)]"
            : "text-[var(--color-accent)]";
          return (
            <li key={item.label} className="relative">
              <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.94 }}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  className={`group relative flex size-10 items-center justify-center rounded-lg transition-colors ${
                    active
                      ? `${accent} bg-zinc-800/60`
                      : item.live
                        ? "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40"
                        : "text-zinc-700"
                  }`}
                >
                  <Icon className="size-4" strokeWidth={1.6} aria-hidden />
                  {/* Tooltip on hover */}
                  <span className="pointer-events-none absolute left-full top-1/2 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-zinc-800/60 bg-zinc-950/95 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-300 opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100">
                    {item.label}
                    {!item.live && (
                      <span className="ml-1 text-zinc-600">· soon</span>
                    )}
                  </span>
                  {/* Active indicator: glowing dot to the right */}
                  {active && (
                    <motion.span
                      layoutId="dock-active-indicator"
                      className={`absolute -right-2 top-1/2 size-1.5 -translate-y-1/2 rounded-full ${item.system ? "bg-[var(--color-system)]" : "bg-[var(--color-accent)]"} shadow-[0_0_8px_currentColor]`}
                    />
                  )}
                </Link>
              </motion.div>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
