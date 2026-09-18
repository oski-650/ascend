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
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NAV_DESTINATIONS, NAV_GROUP_ORDER } from "@/navigation/destinations";
import {
  containDialogTab,
  focusElement,
  focusMainContent,
  openCommandPalette,
} from "./modal";
import {
  Boxes,
  Mail,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Hexagon,
  Orbit,
  ListChecks,
  Radar,
  Search,
  Settings,
  Target,
  Wallet,
  Workflow,
  Wrench,
  X,
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
  "/": Orbit,
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
  if (href === "/") return pathname === "/" || pathname === "/galaxy" || pathname === "/galaxy/next";
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
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const routeFocusPendingRef = useRef(false);

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

  // These close over refs and a setState only, so they are stable for the life of the component.
  // That matters: the effects below register global listeners, and a handler that changed identity
  // every render would tear down and re-register them on every keystroke the page receives.
  const closeMobile = useCallback((restoreFocus: boolean) => {
    if (mobileDialogRef.current?.open) mobileDialogRef.current.close();
    setMobileOpen(false);
    if (restoreFocus) requestAnimationFrame(() => focusElement(mobileTriggerRef.current));
  }, []);

  const moveFocusToRoute = useCallback(() => {
    routeFocusPendingRef.current = true;
    closeMobile(false);
    focusMainContent();
  }, [closeMobile]);

  const openPaletteFromMobile = useCallback(() => {
    closeMobile(false);
    requestAnimationFrame(() => openCommandPalette(mobileTriggerRef.current));
  }, [closeMobile]);

  useEffect(() => {
    const dialog = mobileDialogRef.current;
    if (!dialog) return;
    if (mobileOpen && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => focusElement(mobileCloseRef.current));
    } else if (!mobileOpen && dialog.open) {
      dialog.close();
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!routeFocusPendingRef.current) return;
    routeFocusPendingRef.current = false;
    focusMainContent();
  }, [pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const dismissAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) closeMobile(false);
    };
    desktop.addEventListener("change", dismissAtDesktop);
    return () => desktop.removeEventListener("change", dismissAtDesktop);
  }, [closeMobile]);

  // A global shortcut while the drawer owns the modal layer performs a handoff: close first, then
  // open one palette. Capturing prevents the palette's own global listener from toggling twice.
  useEffect(() => {
    if (!mobileOpen) return;
    const handoffShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
        openPaletteFromMobile();
      }
    };
    window.addEventListener("keydown", handoffShortcut, true);
    return () => window.removeEventListener("keydown", handoffShortcut, true);
  }, [mobileOpen, openPaletteFromMobile]);

  const renderNav = (mobile: boolean) => (
    <nav
      aria-label="Primary"
      className={`flex h-full flex-col border-r border-[var(--color-line)] bg-[var(--color-bg)] ${
        mobile ? "w-[min(19rem,calc(100vw-2.75rem))]" : width
      } transition-[width] duration-200`}
    >
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-[var(--color-line)] px-3.5">
        <span aria-hidden className="size-2 shrink-0 rotate-45 bg-[var(--color-accent)]" />
        {(!collapsed || mobile) && (
          <span id={mobile ? "mobile-navigation-title" : undefined} className="t-label text-[var(--color-t1)]">
            Ascend
          </span>
        )}
        {mobile && (
          <button
            ref={mobileCloseRef}
            type="button"
            aria-label="Close navigation"
            onClick={() => closeMobile(true)}
            className="ml-auto flex size-11 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-t2)] transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
          >
            <X className="size-4" strokeWidth={1.6} aria-hidden />
          </button>
        )}
      </div>

      {/* Search is the doorway into the knowledge layer, so it sits at the top of the rail. */}
      <div className="px-2 pt-2.5">
        <button
          type="button"
          onClick={(event) => {
            if (mobile) openPaletteFromMobile();
            else openCommandPalette(event.currentTarget);
          }}
          title="Search (⌘K)"
          className={`flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-sm)] border border-[var(--color-line)] px-2 text-[var(--color-t3)] transition-colors duration-[120ms] hover:border-[var(--color-line-strong)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)] ${
            collapsed && !mobile ? "justify-center" : ""
          }`}
        >
          <Search className="size-4 shrink-0" strokeWidth={1.6} aria-hidden />
          {(!collapsed || mobile) && (
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
            {(!collapsed || mobile) && (
              <p className="t-section px-3.5 pb-1.5 text-[var(--color-t3)]">{group.title}</p>
            )}
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
                      onNavigate={mobile ? moveFocusToRoute : undefined}
                      aria-current={active ? "page" : undefined}
                      title={collapsed && !mobile ? item.label : undefined}
                      className={`flex items-center gap-2.5 px-3.5 transition-colors duration-[120ms] ${
                        mobile ? "min-h-11 py-2" : "py-1.5"
                      } ${
                        active
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-t2)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
                      }`}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden />
                      {(!collapsed || mobile) && <span className="truncate text-[0.84rem]">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {!mobile && (
        <div className="shrink-0 border-t border-[var(--color-line)] p-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-1.5 text-[var(--color-t3)] transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-t1)]"
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
      )}
    </nav>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden shrink-0 md:block">{renderNav(false)}</div>

      {/* Mobile: a real drawer, replacing "no navigation at all below 640px". */}
      <div className="md:hidden">
        <button
          ref={mobileTriggerRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-controls="mobile-navigation-dialog"
          aria-expanded={mobileOpen}
          className="mobile-nav-trigger fixed left-3 top-3 z-50 flex size-11 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)]/90 text-[var(--color-t1)] backdrop-blur"
        >
          <span aria-hidden className="size-2 rotate-45 bg-[var(--color-accent)]" />
        </button>

        <dialog
          ref={mobileDialogRef}
          id="mobile-navigation-dialog"
          aria-labelledby="mobile-navigation-title"
          className="ascend-mobile-drawer"
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closeMobile(true);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeMobile(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") event.stopPropagation();
            containDialogTab(event, mobileDialogRef);
          }}
        >
          <div className="anim-enter h-full">{renderNav(true)}</div>
        </dialog>
      </div>
    </>
  );
}
