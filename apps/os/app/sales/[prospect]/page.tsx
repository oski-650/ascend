// app/sales/[prospect] — THE PROSPECT VIEW.
//
// A peer of the Client view, one zoom level beneath the Pipeline. It answers the same four
// questions in the same order: what am I looking at · why does it matter · what is known about it ·
// what should I do next.
//
// The score is the SIGNAL here, and it is presented the way health is on the Client view: the
// engine's number, the engine's tier word, and the engine's own breakdown rendered verbatim. The
// surface scores nothing — `computeScore` (core/crm) is the sole authority and its result arrives
// already attached to the Prospect.
//
// Actions are real writes and stay exactly as they were (promote / delete route through their
// existing API endpoints, which remain the only writers). Only their presentation changed.
//
// ─── 2A.2b · THE WORKING SURFACE COMES FIRST ───────────────────────────────────────────────────
//
// A salesperson opens this page to do one thing: call, record what happened, decide what's next. So
// the page now leads with a compact header, the Now card (last contact, next follow-up and whether it
// is late, who holds it, the phone as a `tel:` link) and the timeline; the score, intel, research and
// notes follow. On a phone, Call · Record · More sit in a fixed bar at the bottom.
//
// Everything is READ here, server-side, in one guarded lease (`prospectSalesView`, `prospects:read`)
// — including the member names, so no client code fetches to resolve who someone is. The client
// half (`SalesWorkspace`) only opens sheets and posts commands to the frozen route.

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { getProspect, displayName } from "@/lib/sales";
import { compileTargetContext } from "@/lib/compileTargetContext";
import { focusHrefFor } from "@/graph-view/contract";
import { NODE_VISUAL, displayLabel } from "@/graph-view/taxonomy";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import {
  Breadcrumb,
  FactGrid,
  FactRow,
  PageShell,
  ProgressRail,
  QuietEmpty,
  SectionLabel,
} from "@/components/primitives/entity";
import { listNotes } from "@/core/crm/notes";
import { ProspectNotes } from "@/components/sales/ProspectNotes";
import { ProspectResearch } from "@/components/sales/ProspectResearch";
import { listResearchLog } from "@/core/crm/research-log";
import { CopyTargetButton } from "./CopyTargetButton";
import { PromoteButton } from "@/components/PromoteButton";
import { ArchiveProspectButton } from "@/components/ArchiveProspectButton";
import { prospectSalesView } from "@/core/crm/sales";
import { ProspectNow } from "@/components/sales/ProspectNow";
import { AssignmentMenu } from "@/components/sales/AssignmentMenu";
import { ReopenProspect } from "@/components/sales/ReopenProspect";
import { ProspectTimeline } from "@/components/sales/ProspectTimeline";
import { CallButton, LockBanner, RecordButton, SalesWorkspace, WorkspaceNotices } from "@/components/sales/SalesWorkspace";
import type { SheetProspect } from "@/components/sales/RecordContactSheet";
import { personName, stageLabel, type Stage } from "@/components/sales/presentation";

export const dynamic = "force-dynamic";

const TIER_TONE: Record<string, Tone> = {
  priority: "accent",
  hot: "neural",
  warm: "neutral",
  cold: "neutral",
};

const STATUS_TONE: Record<string, Tone> = {
  "closed-won": "good",
  "closed-lost": "neutral",
  proposal: "accent",
  contacted: "neutral",
  lead: "neutral",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ prospect: string }>;
}): Promise<Metadata> {
  const { prospect: slug } = await params;
  const prospect = await getProspect(slug);
  return {
    title: prospect ? `${displayLabel(displayName(prospect))} · Prospect · Ascend OS` : "Prospect · Ascend OS",
  };
}

async function ProspectPageContent({
  params,
  searchParams,
}: {
  params: Promise<{ prospect: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { prospect: slug } = await params;
  const prospect = await getProspect(slug);
  if (!prospect) notFound();

  // AFTER the 404, and awaited separately rather than beside it. §28.4 records F57 catching a
  // `Promise.all` that let an unrelated rejection outrun a denial; the same reasoning applies to a
  // not-found — a page that has already decided this prospect does not exist should not be reading
  // its notes. Returns an empty list for a prospect with none, so this never throws for that.
  // The timeline cursor is opaque: the page passes it back and never reads it. A tampered value is
  // ignored by the read, which then starts at the newest entry.
  const rawCursor = (await searchParams)?.cursor;
  const cursor = typeof rawCursor === "string" ? rawCursor : null;
  const view = prospect.rowId === null ? null : await prospectSalesView(prospect.rowId, { cursor });
  const notes = await listNotes(slug);
  // Awaited separately, after the 404 — same reasoning as the notes read above.
  const researchLog = await listResearchLog(slug);

  const fm = prospect.frontmatter;
  const score = prospect.score;
  const name = displayLabel(displayName(prospect));
  // Never `?? "lead"` — a prospect whose status nobody recorded is not a lead, and rendering one
  // makes absence indistinguishable from a recorded pipeline position.
  //
  // Absence is represented as `undefined` and handled at the render boundary, NOT by widening
  // ProspectStatus. Adding an `unknown` member to satisfy a type here would repeat the original
  // failure in a more sophisticated form; if a durable three-way distinction is ever needed it
  // deserves its own domain decision, exactly as PhaseStatus got one.
  const status = typeof fm.status === "string" && fm.status.trim() ? fm.status : undefined;
  const payload = compileTargetContext(prospect);
  const graphHref = focusHrefFor("prospect", slug);

  const summary = view?.summary ?? null;
  const names = view?.directory.names ?? {};
  const viewer = view?.directory.viewer ?? "";
  const canManage = view?.canManage === true;
  // The sales tables are authoritative for stage once they exist; the frontmatter is the vault's shape.
  const stage = (summary?.status ?? status ?? null) as Stage | null;
  const archived = prospect.archivedAt !== null || summary?.archived === true;
  const serverLock = summary?.held ? "held" : archived ? "archived" : null;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const phone = text(fm.contact_phone);
  const email = text(fm.contact_email);
  const website = text(fm.website);
  const assignee = summary?.assignedTo ?? null;
  const assigneeLabel = !summary ? null : assignee === null ? "Unassigned" : assignee === viewer ? "Assigned to you" : `Assigned to ${personName(assignee, names)}`;

  const sheetProspect: SheetProspect | null = summary && {
    rowId: summary.id,
    slug,
    name,
    stage,
    assignedTo: assignee,
    assigneeName: assignee ? personName(assignee, names) : null,
    viewerIsAssignee: assignee !== null && assignee === viewer,
    openFollowUp: summary.openFollowUp && {
      action: summary.openFollowUp.action,
      dueOn: summary.openFollowUp.dueOn,
      dueAt: summary.openFollowUp.dueAt,
      assigneeName: summary.openFollowUp.assignee === viewer ? "you" : personName(summary.openFollowUp.assignee, names),
    },
    lastChannel: (summary.latestContact?.channel ?? null) as SheetProspect["lastChannel"],
  };

  // With the Now card showing how to reach them, Intel keeps only what the card does not.
  const intel: { label: string; value: unknown; link?: boolean }[] = [
    ...(summary ? [] : [
      { label: "Contact", value: fm.contact_name },
      { label: "Phone", value: fm.contact_phone },
      { label: "Email", value: fm.contact_email },
    ]),
    { label: "Decision-maker access", value: boolish(fm.decision_maker_access) },
    // Website and its grade moved to the Web presence section, which shows them with the evidence
    // behind them. Repeating them here as two bare words would be the same facts, worse told.
    { label: "Project urgency", value: fm.project_urgency },
    { label: "Niche alignment", value: boolish(fm.niche_alignment) },
    { label: "Source", value: fm.source },
    ...(summary ? [] : [
      { label: "First contact", value: fm.first_contact },
      { label: "Last contact", value: fm.last_contact },
    ]),
  ];
  const known = intel.filter((f) => f.value !== undefined && f.value !== null && f.value !== "");

  // The page's secondary actions: inline on a tablet or desktop, in the More sheet on a phone.
  const secondary = (
    <>
      {graphHref && (
        <Link href={graphHref} className="contents">
          <Button variant="ghost">Focus in Galaxy</Button>
        </Link>
      )}
      <CopyTargetButton payload={payload} />
      {/* Neither action is offered on an archived prospect. The server refuses both anyway —
          promotion with `archived_prospect`, archival with `already_archived` — so this is the
          UI agreeing with the server rather than a second, weaker gate in front of it. */}
      {!archived && (
        <>
          <PromoteButton prospectSlug={prospect.slug} prospectName={name} alreadyWon={stage === "closed-won"} />
          <ArchiveProspectButton prospectSlug={prospect.slug} prospectName={name} />
        </>
      )}
    </>
  );

  const header = (
    <header className="mb-6">
      <div className="flex items-center gap-1.5">
        <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: NODE_VISUAL.prospect.color }} />
        <span className="t-label text-[var(--color-t3)]">Prospect</span>
      </div>
      <h1 className="mt-2 max-w-[26ch] text-balance text-[1.75rem] font-medium leading-[1.1] tracking-[-0.025em] text-[var(--color-t1)] sm:text-[2.25rem]">
        {name}
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* D1b · AN ARCHIVED PROSPECT SAYS SO, FIRST. The page is still reachable by its address on
            purpose (owner decision 3) so the notes and history stay readable — but a record the
            operator removed from the hit list must never read as an active one. */}
        {archived && <Status tone="neutral">Archived</Status>}
        {summary?.held && <Status tone="neutral">On hold</Status>}
        <Status tone={stage ? STATUS_TONE[stage] ?? "neutral" : "neutral"}>
          {stage ? stageLabel(stage) : "Unknown status"}
        </Status>
        {assigneeLabel && <span className="t-meta text-[var(--color-t2)]">{assigneeLabel}</span>}
        {canManage && summary && !serverLock && (
          <AssignmentMenu
            slug={slug} rowId={summary.id} assignedTo={summary.assignedTo}
            names={names} openFollowUp={summary.openFollowUp}
          />
        )}
        {canManage && summary && !serverLock && stage === "closed-lost" && (
          <ReopenProspect slug={slug} rowId={summary.id} stage={stage} />
        )}
        {fm.business_type && <Badge>{String(fm.business_type)}</Badge>}
        {fm.location && <span className="t-mono text-[var(--color-t3)]">{String(fm.location)}</span>}
      </div>
      <div className={`mt-5 flex-wrap items-center gap-x-2 gap-y-2 border-t border-[var(--color-line)] pt-4 ${summary ? "hidden md:flex" : "flex"}`}>
        {summary && !serverLock && (
          <>
            <CallButton />
            <RecordButton />
            <span aria-hidden className="mx-1 h-5 w-px bg-[var(--color-line)]" />
          </>
        )}
        {secondary}
      </div>
    </header>
  );

  const reference = (
    <>
      {/* ── SCORE (SIGNAL) ───────────────────────────────────────────────────────────────────
          The lead figure, attributed to the scorer that owns it. The breakdown beneath is the
          scorer's own `breakdown` array, rendered in its order with its point values. */}
      <section className="mb-11">
        {/* ─── AN UNRESEARCHED TARGET SAYS SO ONCE, NOT THREE TIMES ───────────────────────────
            A prospect nothing is known about scored 0, 0% and 0 criteria — three large figures
            stating the same absence, above a line that stated it a fourth time. That is most of
            this page's visual weight spent on "we have not looked yet", and after the 2026-09
            import it is the state of 3,102 of 3,108 records.

            The figures are kept for a target that has ACTUALLY been scored, because there the three
            numbers differ and each earns its place. */}
        {score.score === 0 && score.breakdown.length === 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="t-h2 text-[var(--color-t2)]">Not researched yet</span>
            <span className="t-mono text-[var(--color-t3)]">
              scores 0 of {score.max} · ↳ computeScore
            </span>
          </div>
        ) : (
          <FactGrid
            lead={
              <FactRow
                lead
                value={String(score.score)}
                label="Priority score"
                detail={`${score.tier} · out of ${score.max}`}
                attribution="computeScore"
                tone={TIER_TONE[score.tier] === "accent" ? "accent" : undefined}
              />
            }
          >
            <FactRow
              value={`${Math.round((score.score / score.max) * 100)}%`}
              label="Of maximum"
              detail="how much of the rubric this target matches"
            />
            <FactRow
              value={String(score.breakdown.length)}
              label="Criteria met"
              detail="see breakdown"
            />
          </FactGrid>
        )}

        <div className={`max-w-[520px] ${score.breakdown.length === 0 ? "hidden" : "mt-8"}`}>
          <p className="t-label mb-2.5 text-[var(--color-t3)]">Why this score ↳ computeScore</p>
          {score.breakdown.length === 0 ? (
            <QuietEmpty>No criteria matched yet — this target still needs research.</QuietEmpty>
          ) : (
            <ul className="flex flex-col">
              {score.breakdown.map((b) => (
                <li
                  key={b.key}
                  className="flex items-baseline gap-4 border-b border-[var(--color-line)] py-2 last:border-b-0"
                >
                  <span className="t-mono w-8 shrink-0 text-[var(--color-accent)]">+{b.points}</span>
                  <span className="t-body min-w-0 flex-1 text-[var(--color-t2)]">{b.label}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <ProgressRail
              value={Math.round((score.score / score.max) * 100)}
              tone={TIER_TONE[score.tier] === "accent" ? "accent" : "neutral"}
              label="Priority score"
            />
          </div>
        </div>
      </section>

      {/* ── WHAT IS KNOWN (FACT) ─────────────────────────────────────────────────────────────
          Only fields the vault actually contains. Absent intel is stated as a count rather than
          rendered as a column of em-dashes — an empty field is not information. */}
      <section className="mb-11">
        <SectionLabel
          tier="primary"
          aside={`${known.length} of ${intel.length} recorded`}
        >
          Intel
        </SectionLabel>
        {known.length === 0 ? (
          <QuietEmpty>Nothing else recorded about this target yet.</QuietEmpty>
        ) : (
          // Two columns only from `lg`. At `sm` each column was ~250px and an address like
          // info@propshoprichmond.com filled it edge to edge.
          <dl className="grid grid-cols-1 gap-x-10 lg:grid-cols-2">
            {known.map((f) => (
              <div
                key={f.label}
                className="flex items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-2.5"
              >
                <dt className="t-label shrink-0 text-[var(--color-t3)]">{f.label}</dt>
                {/* `break-all`, not `truncate`: an email or URL that ends in an ellipsis is not a
                    contact detail you can use. It wraps instead. */}
                <dd className="t-body min-w-0 break-all text-right text-[var(--color-t1)]">
                  {f.link ? (
                    <a
                      href={String(f.value)}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline-offset-4 hover:text-[var(--color-accent)] hover:underline"
                    >
                      {String(f.value).replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    String(f.value)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ── RESEARCH ─────────────────────────────────────────────────────────────────────────── */}
      {/* Promoted from "quiet" to "decision": on an unresearched list this is the one axis that
          moves a prospect's rank, and the log beneath it is the evidence for that move. */}
      <section id="research" className="mb-11 scroll-mt-16">
        <SectionLabel tier="decision" aside={researchLog.length > 0 ? `${researchLog.length} recorded` : undefined}>
          Web presence
        </SectionLabel>
        <ProspectResearch
          prospect={slug}
          website={website}
          quality={typeof fm.website_quality === "string" ? fm.website_quality : null}
          log={researchLog}
        />
      </section>

      {/* ── NOTES ────────────────────────────────────────────────────────────────────────────── */}
      {/*
        TWO SECTIONS, NOT ONE, AND THEY ARE DIFFERENT KINDS OF RECORD.

        `prospect.body` is `prospects.notes` — the markdown document carried verbatim out of the
        vault by 003. It has no author and no timestamp because the file it came from had none.
        Below it is the note LOG (008): rows, each with the person who wrote it and when.

        They are not merged. Presenting the imported body as an entry authored by whoever happens to
        be reading, at whatever time the migration ran, would fabricate exactly the two facts the
        log exists to record.
      */}
      <section id="notes" className="mb-11 scroll-mt-16">
        <SectionLabel tier="quiet">Notes</SectionLabel>
        <ProspectNotes prospect={slug} notes={notes} />
      </section>

      {prospect.body && (
        <section>
          <SectionLabel tier="quiet">Imported call log</SectionLabel>
          <article
            className="prose-ascend max-w-[68ch]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(prospect.body) }}
          />
        </section>
      )}
    </>
  );

  const crumbs = (
    <Breadcrumb
      items={[
        { label: "Galaxy", href: "/" },
        { label: "Pipeline", href: "/sales" },
        { label: name },
      ]}
    />
  );

  // Vault mode (no sales tables): the page as it was, without an action surface to pretend with.
  if (!view || !sheetProspect) {
    return (
      <PageShell hue={NODE_VISUAL.prospect.color}>
        {crumbs}
        {header}
        {reference}
      </PageShell>
    );
  }

  const earlierHref = view.timeline.next ? `?cursor=${encodeURIComponent(view.timeline.next)}#timeline` : null;

  // The workspace wraps the SHELL, not the other way round: PageShell's entry animation transforms
  // its subtree, and a transformed ancestor captures `position: fixed` — the phone action bar would
  // scroll away with the page. The provider renders no element, so PageShell stays `main`'s child.
  return (
    <SalesWorkspace
      prospect={sheetProspect}
      phone={phone}
      serverLock={serverLock}
      more={
        <>
          <a href="#notes" className="t-label inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t2)]">Add a note</a>
          <a href="#research" className="t-label inline-flex min-h-11 items-center rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] px-3 text-[var(--color-t2)]">Web presence</a>
          {secondary}
        </>
      }
    >
      <PageShell hue={NODE_VISUAL.prospect.color}>
        {crumbs}
        {header}
        {serverLock && <LockBanner lock={serverLock} />}
        <WorkspaceNotices />
        {/* Two columns from 1024 only: at 768 the card's column was ~400px and a phone number broke
            across lines. The card hugs its content (`items-start`) instead of stretching to the
            timeline's height. */}
        <div className="mb-11 grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <ProspectNow
            summary={view.summary}
            names={names}
            viewer={viewer}
            contactName={text(fm.contact_name)}
            phone={phone}
            email={email}
            website={website}
            canManage={canManage && !serverLock}
            slug={slug}
          />
          <ProspectTimeline
            entries={view.timeline.entries}
            names={names}
            before={cursor}
            earlierHref={earlierHref}
            latestHref={`/sales/${encodeURIComponent(slug)}#timeline`}
          />
        </div>
        {reference}
      </PageShell>
    </SalesWorkspace>
  );
}

function boolish(v: boolean | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v ? "yes" : "no";
}

// ─── WRAPPED FOR THE REVOCATION SURFACE, NOT FOR A DENIAL (2G.4.5, STAGE2G §29.3 Ruling 3) ─────
//
// This page demands a capability a sales principal HOLDS, so it has no `CapabilityDenied` to
// convert and did not need `renderOrDenied` while the only convertible refusal was that one.
// `AccountRefused` changes that: a revoked, unmembered or unknown account reaches EVERY page that
// requests authority, and unwrapped it would reach `app/error.tsx` — which is parked finding 2
// itself, surviving in the four pages nobody had reason to wrap. Wrapping costs nothing for the
// principals who hold the capability and is the difference between a named surface and an outage
// message for the one who no longer does.

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function ProspectPage(...props: Parameters<typeof ProspectPageContent>) {
  return renderOrDenied("Pipeline", () => ProspectPageContent(...props));
}
