"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { BrowseValues } from "@/lib/sales-queue-url";

type FilterValues = Omit<BrowseValues, "cursor" | "invalidCursor">;
type Props = { values: FilterValues; names: Record<string, string>; activeCount: number; clearHref: string };

const field = "flex min-w-0 flex-col gap-1 text-sm text-[var(--color-t2)]";
const input = "min-h-11 w-full min-w-0 rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-t1)]";

function FilterForm({ values, names, clearHref, showClear }: Omit<Props, "activeCount"> & { showClear: boolean }) {
  return <form action="/sales/list" method="get" aria-label="Sales filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <label className={field}>Scope<select name="scope" defaultValue={values.scope} className={input}><option value="mine">Mine + Unassigned</option><option value="team">Team</option></select></label>
    <label className={field}>Assignee<select name="assignee" defaultValue={values.assignee} className={input}><option value="">Scope default</option><option value="unassigned">Unassigned only</option>{Object.entries(names).sort((a,b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    <label className={field}>Stage<select name="stage" defaultValue={values.stage} className={input}><option value="">Open pipeline</option><option value="lead">Lead</option><option value="contacted">Contacted</option><option value="proposal">Proposal</option><option value="closed-won">Closed · Won</option><option value="closed-lost">Closed · Lost</option></select></label>
    <label className={field}>Due state<select name="due" defaultValue={values.due} className={input}><option value="">Any</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="upcoming">Upcoming</option><option value="none">No follow-up</option></select></label>
    <label className={field}>Contacted within<select name="within" defaultValue={values.within} className={input}><option value="">Any time</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label>
    <label className={field}>Name starts with<input name="name" type="search" maxLength={80} defaultValue={values.name} className={input} /></label>
    <label className={field}>Sort by<select name="sort" defaultValue={values.sort} className={input}><option value="name">Name</option><option value="due">Next due</option><option value="last_contact">Last contact</option></select></label>
    <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--color-t2)]"><input name="never" type="checkbox" value="1" defaultChecked={values.never} className="size-5" />Never contacted</label>
    <div className="flex flex-wrap items-end gap-3"><button type="submit" className="inline-flex min-h-11 items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-5 text-sm font-medium text-[var(--color-bg)]">Apply filters</button>{showClear && <Link href={clearHref} className="inline-flex min-h-11 items-center text-sm text-[var(--color-t2)] underline underline-offset-4">Clear filters</Link>}</div>
  </form>;
}

export function SalesBrowseFilters(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const desktopSummary = useRef<HTMLElement>(null);
  const label = `Filters & sort${props.activeCount ? ` · ${props.activeCount} applied` : ""}`;

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 640px)");
    const closeOnDesktop = () => {
      if (desktop.matches && dialog.current?.open) dialog.current.close();
    };
    desktop.addEventListener("change", closeOnDesktop);
    closeOnDesktop();
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return <>
    <div className="mb-7 hidden border-y border-[var(--color-line)] py-3 sm:block">
      <details>
        <summary ref={desktopSummary} className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-[var(--color-t1)]"><span>{label}</span><span aria-hidden>⌄</span></summary>
        <div className="mt-4 border-t border-[var(--color-line)] pt-4"><FilterForm values={props.values} names={props.names} clearHref={props.clearHref} showClear={props.activeCount > 0} /></div>
      </details>
    </div>
    <div className="mb-7 border-y border-[var(--color-line)] py-3 sm:hidden">
      <button ref={trigger} type="button" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); close.current?.focus(); }} className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm text-[var(--color-t1)]"><span>{label}</span><span aria-hidden>⌄</span></button>
      <dialog ref={dialog} aria-labelledby="sales-filter-heading" onClose={() => { if (window.matchMedia("(min-width: 640px)").matches) desktopSummary.current?.focus(); else trigger.current?.focus(); }} className="m-0 h-dvh max-h-dvh w-screen max-w-none overflow-y-auto bg-[var(--color-bg)] p-5 text-[var(--color-t1)] backdrop:bg-black/70">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-[var(--color-line)] pb-3"><h2 id="sales-filter-heading" className="t-h2">Filters &amp; sort</h2><button ref={close} type="button" onClick={() => dialog.current?.close()} className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--color-t2)]">Close</button></div>
        <FilterForm values={props.values} names={props.names} clearHref={props.clearHref} showClear={props.activeCount > 0} />
      </dialog>
    </div>
  </>;
}
