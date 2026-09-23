import Link from "next/link";
import type { Metadata } from "next";
import { salesBrowsePage } from "@/core/crm/sales";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { PageShell, SurfaceHeader } from "@/components/primitives/entity";
import { SalesQueueRow } from "@/components/sales/SalesQueueRow";
import { SalesBrowseFilters } from "@/components/sales/SalesBrowseFilters";
import { browseHref, type SearchValues } from "@/lib/sales-queue-url";
import { NODE_VISUAL } from "@/graph-view/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Browse sales · Ascend OS" };

async function SalesListContent({ searchParams }: { searchParams?: Promise<SearchValues> }) {
  const { page, directory, values } = await salesBrowsePage(await searchParams ?? {});
  const { rows, next } = page;
  const base = { scope: values.scope, assignee: values.assignee, stage: values.stage, due: values.due, never: values.never, within: values.within, name: values.name, sort: values.sort };
  const clearHref = browseHref({ scope: values.scope, assignee: "", stage: "", due: "", never: false, within: "", name: "", sort: "name" });
  const active = [values.assignee && (values.assignee === "unassigned" ? "Unassigned" : directory.names[values.assignee] ?? "Assignee"), values.stage && values.stage.replaceAll("-", " "), values.due && `Due ${values.due}`, values.never && "Never contacted", values.within && `Contacted within ${values.within} days`, values.name && `Name starts with “${values.name}”`].filter(Boolean);
  const hasResultFilters = Boolean(values.assignee || values.stage || values.due || values.never || values.within || values.name);
  const title = values.stage.startsWith("closed-") ? "Closed prospects" : "Open pipeline";

  return <PageShell hue={NODE_VISUAL.prospect.color}>
    <nav aria-label="Breadcrumb" className="mb-5 text-sm text-[var(--color-t2)]"><Link href={`/sales?scope=${values.scope}`} className="inline-flex min-h-11 items-center underline underline-offset-4">← Sales work queue</Link></nav>
    <SurfaceHeader eyebrow="Sales · Browse" title={title} lede="Explore prospects a page at a time. Work that needs attention is on the sales queue." />

    <SalesBrowseFilters values={base} names={directory.names} activeCount={active.length} clearHref={clearHref} />

    {active.length > 0 && <p className="mb-5 break-words text-sm text-[var(--color-t2)]" aria-live="polite">Showing: {active.join(" · ")}</p>}
    {values.invalidCursor && <p className="mb-5 border-l-2 border-[var(--color-risk)] pl-4 text-sm text-[var(--color-t2)]">That page link was invalid. Showing the first page.</p>}
    <section aria-label="Prospects">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-line-strong)] pb-3"><h2 className="t-h2">Prospects</h2><span className="text-sm text-[var(--color-t3)]">{rows.length} on this page</span></div>
      {rows.length ? <ul>{rows.map((row) => <SalesQueueRow key={row.id} row={row} names={directory.names} now={new Date()} />)}</ul> : <div className="py-10">{hasResultFilters ? <><p className="text-base text-[var(--color-t1)]">No prospects match these filters.</p><Link href={clearHref} className="mt-3 inline-flex min-h-11 items-center text-sm text-[var(--color-t2)] underline underline-offset-4">Clear filters</Link></> : <><p className="text-base text-[var(--color-t1)]">No open prospects in this scope.</p><p className="mt-2 text-sm text-[var(--color-t2)]">There is no open pipeline work to browse here right now.</p></>}</div>}
    </section>
    {next && <nav aria-label="Pagination" className="mt-7 flex justify-end"><Link href={browseHref(base, next)} rel="next" className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-5 text-sm text-[var(--color-t1)]">Next page →</Link></nav>}
  </PageShell>;
}

export default async function SalesListPage(props: { searchParams?: Promise<SearchValues> }) {
  return renderOrDenied("Sales", () => SalesListContent(props));
}
