import Link from "next/link";
import type { Metadata } from "next";
import { salesWorkQueue, type SalesSection } from "@/core/crm/sales";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { PageShell, SurfaceHeader } from "@/components/primitives/entity";
import { SalesQueueRow } from "@/components/sales/SalesQueueRow";
import { AddTargetForm } from "@/components/AddTargetForm";
import { browseHref, type BrowseValues, type SearchValues } from "@/lib/sales-queue-url";
import { NODE_VISUAL } from "@/graph-view/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sales work queue · Ascend OS" };

const SECTIONS: Record<SalesSection, { title: string; empty: string; filters: Partial<BrowseValues> }> = {
  overdue: { title: "Overdue", empty: "Nothing overdue", filters: { due: "overdue", sort: "due" } },
  due_today: { title: "Due today", empty: "Nothing due today", filters: { due: "today", sort: "due" } },
  unassigned: { title: "Unassigned", empty: "No unassigned prospects", filters: { assignee: "unassigned" } },
  never_contacted: { title: "Never contacted", empty: "No prospects waiting for first contact", filters: { never: true } },
  recently_contacted: { title: "Recently contacted", empty: "No recent contact", filters: { within: "7", sort: "last_contact" } },
};

async function SalesPageContent({ searchParams }: { searchParams?: Promise<SearchValues> }) {
  const raw = await searchParams ?? {};
  const requested = Array.isArray(raw.scope) ? "" : raw.scope;
  const { sections, directory, scope } = await salesWorkQueue(requested);
  const now = new Date();
  const base: Omit<BrowseValues, "cursor" | "invalidCursor"> = { scope, assignee: "", stage: "", due: "", never: false, within: "", name: "", sort: "name" };
  const allCaughtUp = sections.every((s) => s.total === 0);

  return <PageShell hue={NODE_VISUAL.prospect.color}>
    <SurfaceHeader eyebrow="Sales · Work" title="Who needs attention today?" lede="Your next calls and follow-ups, in a bounded work queue." />
    <nav aria-label="Sales scope" className="sticky top-0 z-10 mb-9 flex flex-wrap items-center gap-2 border-y border-[var(--color-line)] bg-[var(--color-bg)] py-3">
      <span className="t-label mr-2 text-[var(--color-t3)]">Show</span>
      {(["mine", "team"] as const).map((option) => <Link key={option} href={`/sales?scope=${option}`} aria-current={scope === option ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border px-4 text-sm ${scope === option ? "border-[var(--color-accent)] text-[var(--color-t1)]" : "border-[var(--color-line-strong)] text-[var(--color-t2)]"}`}>{option === "mine" ? "Mine + Unassigned" : "Team"}</Link>)}
      <Link href={browseHref(base)} className="ml-auto inline-flex min-h-11 items-center text-sm text-[var(--color-t2)] underline underline-offset-4">Browse open pipeline ↗</Link>
    </nav>

    <nav aria-label="Queue sections" className="mb-10 flex flex-wrap gap-x-5 gap-y-2 text-sm text-[var(--color-t2)]">
      {sections.map(({ section, total }) => <a key={section} href={`#${section}`} className="inline-flex min-h-11 items-center underline-offset-4 hover:underline">{SECTIONS[section].title} · {total}</a>)}
    </nav>

    {allCaughtUp && <div className="mb-10 border-l-2 border-[var(--color-accent)] py-2 pl-5"><h2 className="t-h2">All caught up</h2><p className="mt-1 text-sm text-[var(--color-t2)]">No work appears in these five sections. <Link href={browseHref(base)} className="underline underline-offset-4">Browse the open pipeline</Link>.</p></div>}

    <div className="space-y-12">
      {sections.map(({ section, rows, total, limit }) => {
        const config = SECTIONS[section];
        const href = browseHref({ ...base, ...config.filters });
        return <section id={section} key={section} aria-labelledby={`${section}-heading`} className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[var(--color-line-strong)] pb-3">
            <h2 id={`${section}-heading`} className="t-h2 text-[var(--color-t1)]">{config.title} <span className="ml-1 text-[var(--color-t3)]">{total}</span></h2>
            <Link href={href} className="inline-flex min-h-11 items-center text-sm text-[var(--color-t2)] underline underline-offset-4">See all{total > limit ? ` ${total}` : ""} ↗</Link>
          </div>
          {rows.length ? <ul>{rows.map((row) => <SalesQueueRow key={row.id} row={row} names={directory.names} now={now} />)}</ul> : <p className="py-3 text-sm text-[var(--color-t2)]">{config.empty}</p>}
        </section>;
      })}
    </div>

    <section className="mt-14 border-t border-[var(--color-line)] pt-7" aria-label="Browse and add prospects">
      <Link href={browseHref(base)} className="inline-flex min-h-11 items-center text-base text-[var(--color-t1)] underline underline-offset-4">Browse open pipeline ↗</Link>
      <h2 className="t-h2 mt-9 mb-3">Add a target</h2>
      <AddTargetForm />
      <p className="mt-4 text-sm text-[var(--color-t2)]"><Link href="/sales/import" className="underline underline-offset-4">Import from CSV</Link></p>
    </section>
  </PageShell>;
}

export default async function SalesPage(props: { searchParams?: Promise<SearchValues> }) {
  return renderOrDenied("Sales", () => SalesPageContent(props));
}
