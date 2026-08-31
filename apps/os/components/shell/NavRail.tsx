"use client";

// components/shell/NavRail — labeled, grouped navigation.
//
// ─── 2G.3 §28.7 — IT DRAWS WHAT IT IS TOLD, AND DECIDES NOTHING ────────────────────────────────
//
// `visible` is a list of hrefs resolved on the SERVER (lib/nav-visibility) and handed down as data.
// This component holds no capabilities, no principal and no role, and it must not acquire any: F54
// forbids the decision surface here, and F57 separately proves that every destination this rail
// omits still refuses that principal when requested directly.
//
//     navigation filtering  =  presentation
//     PAGE_AUTHORIZATION    =  authorization
//
// The labels, groups and order below are presentation. `navigation/destinations` owns the table
// itself, because a test must be able to read it — F56 checks every href against the declared page
// contract, so a link to a page nobody classified fails the gate rather than shipping.
//
// Replaces OrbitalDock (12 unlabeled icons, one of them a dead link). Recognition over recall:
// groups are titled, items are labeled, and the active route is stated with an accent bar rather
// than a 6px dot. Collapsible to icons, with the state persisted. Mobile gets a real drawer —
// the previous rail was `hidden sm:flex` with no replacement, i.e. no navigation at all below 640px.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { NAV_DESTINATIONS, NAV_GROUP_ORDER } from "@/navigation/destinations";
import {
  Boxes,
  Mail,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Hexagon,
  ListChecks,
  Radar,
  Search,
  Settings,
  Target,
  Wallet,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

type Item = { label: string; href: string; icon: LucideIcon };
type Group = { title: string; items: Item[] };

/**
 * Icon per destination. Presentation, keyed by href so it cannot drift out of step with the table
 * silently — a destination with no icon here renders with the fallback rather than disappearing,
 * because a missing icon is a cosmetic defect and a missing LINK is a navigational one.
 */
const ICONS: Record<string, LucideIcon> = {
  "/": Hexagon,
  "/partner": Target,
  "/crm": Building2,
  "/production": Workflow,
  "/sales": Target,
  "/tasks": ListChecks,
  "/signals": Radar,
  "/automations": Zap,
  "/maintenance": Wrench,
  "/documents": FileText,
  "/console": Boxes,
  "/finance": Wallet,
  "/admin": Settings,
  "/admin/invitations": Mail,
};

/** Group the visible destinations, preserving the declared group order and table order. */
function groupsFor(visible: readonly string[]): Group[] {
  const shown = new Set(visible);
  return NAV_GROUP_ORDER.map((title) => ({
    title,
    items: NAV_DESTINATIONS
      .filter((d) => d.group === title && shown.has(d.href))
      .map((d) => ({ label: d.label, href: d.href, icon: ICONS[d.href] ?? Hexagon })),
  })).filter((g) => g.items.length > 0);   // an empty group is not a heading
}

const STORAGE_KEY = "ascend-nav-collapsed";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The collapsed flag is external state (localStorage), so it is read through useSyncExternalStore
 * rather than mirrored into an effect. That keeps it SSR-safe — the server snapshot is always
 * `false` — without a setState-in-effect cascade on every mount.
 */
const COLLAPSE_EVENT = "ascend:nav-collapse";

function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener(COLLAPSE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(COLLAPSE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function NavRail({ visible }: { visible: readonly string[] }) {
  const pathname = usePathname();
  const groups = groupsFor(visible);
  const [mobileOpen, setMobileOpen] = useState(false);

  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    () => localStorage.getItem(STORAGE_KEY) === "1",
    () => false // server snapshot: always expanded
  );

  const toggle = () => {
    localStorage.setItem(STORAGE_KEY, collapsed ? "0" : "1");
    window.dispatchEvent(new CustomEvent(COLLAPSE_EVENT));
  };

  const width = collapsed ? "w-[56px]" : "w-[208px]";

  const nav = (
    <nav
      aria-label="Primary"
      className={`flex h-full flex-col border-r border-[var(--color-line)] bg-[var(--color-bg)] ${width} transition-[width] duration-200`}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-3.5">
        <span aria-hidden className="size-2 shrink-0 rotate-45 bg-[var(--color-accent)]" />
        {!collapsed && <span className="t-label text-[var(--color-t1)]">Ascend</span>}
      </div>

      {/* Search is the doorway into the knowledge layer, so it sits at the top of the rail. */}
      <div className="px-2 pt-2.5">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("ascend:open-palette"))}
          title="Search (⌘K)"
          className={`flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-1.5 py-1.5 text-[var(--color-t3)] transition-colors duration-[120ms] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)] ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <Search className="size-4 shrink-0" strokeWidth={1.6} aria-hidden />
          {!collapsed && (
            <>
              <span className="t-label flex-1 text-left">Search</span>
              <kbd className="t-mono text-[var(--color-t3)]">⌘K</kbd>
            </>
          )}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        {groups.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed && <p className="t-section px-3.5 pb-1.5 text-[var(--color-t3)]">{group.title}</p>}
            <ul>
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href} className="relative">
                    {active && (
                      <span aria-hidden className="absolute inset-y-1 left-0 w-[2px] bg-[var(--color-accent)]" />
                    )}
                    <Link
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-2.5 px-3.5 py-1.5 transition-colors duration-[120ms] ${
                        active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-t2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden />
                      {!collapsed && <span className="truncate text-[0.84rem]">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-[var(--color-line)] p-2">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 py-1.5 text-[var(--color-t3)] transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
        >
          {collapsed ? (
            <ChevronsRight className="size-4" strokeWidth={1.6} aria-hidden />
          ) : (
            <>
              <ChevronsLeft className="size-4" strokeWidth={1.6} aria-hidden />
              <span className="t-label">Collapse</span>
            </>
          )}
        </button>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden shrink-0 md:block">{nav}</div>

      {/* Mobile: a real drawer, replacing "no navigation at all below 640px". */}
      <div className="md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="fixed left-3 top-3 z-50 flex size-9 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]/90 text-[var(--color-t1)] backdrop-blur"
        >
          <span aria-hidden className="size-2 rotate-45 bg-[var(--color-accent)]" />
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div className="anim-enter h-full">{nav}</div>
            <button
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
              className="h-full flex-1 bg-black/60 backdrop-blur-sm"
            />
          </div>
        )}
      </div>
    </>
  );
}