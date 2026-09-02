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

import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { getProspect, displayName, statusLabel } from "@/lib/sales";
import { compileTargetContext } from "@/lib/compileTargetContext";
import { focusHrefFor } from "@/graph-view/contract";
import { NODE_VISUAL, displayLabel } from "@/graph-view/taxonomy";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import {
  Breadcrumb,
  EntityHeader,
  FactGrid,
  FactRow,
  PageShell,
  ProgressRail,
  QuietEmpty,
  SectionLabel,
} from "@/components/primitives/entity";
import { CopyTargetButton } from "./CopyTargetButton";
import { PromoteButton } from "@/components/PromoteButton";
import { DeleteProspectButton } from "@/components/DeleteProspectButton";

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

async function ProspectPageContent({ params }: { params: Promise<{ prospect: string }> }) {
  const { prospect: slug } = await params;
  const prospect = await getProspect(slug);
  if (!prospect) notFound();

  const fm = prospect.frontmatter;
  const score = prospect.score;
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

  const intel: { label: string; value: unknown; link?: boolean }[] = [
    { label: "Contact", value: fm.contact_name },
    { label: "Phone", value: fm.contact_phone },
    { label: "Email", value: fm.contact_email },
    { label: "Decision-maker access", value: boolish(fm.decision_maker_access) },
    { label: "Website", value: fm.website, link: true },
    { label: "Website quality", value: fm.website_quality },
    { label: "Project urgency", value: fm.project_urgency },
    { label: "Niche alignment", value: boolish(fm.niche_alignment) },
    { label: "Source", value: fm.source },
    { label: "First contact", value: fm.first_contact },
    { label: "Last contact", value: fm.last_contact },
  ];
  const known = intel.filter((f) => f.value !== undefined && f.value !== null && f.value !== "");

  return (
    <PageShell hue={NODE_VISUAL.prospect.color}>
      <Breadcrumb
        items={[
          { label: "Neural Core", href: "/" },
          { label: "Pipeline", href: "/sales" },
          { label: displayLabel(displayName(prospect)) },
        ]}
      />

      <EntityHeader
        kind="Prospect"
        kindColor={NODE_VISUAL.prospect.color}
        name={displayLabel(displayName(prospect))}
        facts={
          <>
            <Status tone={status ? STATUS_TONE[status] ?? "neutral" : "neutral"}>
              {status ? statusLabel(status) : "Unknown status"}
            </Status>
            {fm.business_type && <Badge>{String(fm.business_type)}</Badge>}
            {fm.location && (
              <span className="t-mono text-[var(--color-t3)]">{String(fm.location)}</span>
            )}
          </>
        }
        actions={
          <>
            {graphHref && (
              <Link href={graphHref} className="contents">
                <Button variant="ghost">Focus in Neural Core</Button>
              </Link>
            )}
            <CopyTargetButton payload={payload} />
            <PromoteButton
              prospectSlug={prospect.slug}
              prospectName={displayLabel(displayName(prospect))}
              alreadyWon={status === "closed-won"}
            />
            <DeleteProspectButton
              prospectSlug={prospect.slug}
              prospectName={displayLabel(displayName(prospect))}
            />
          </>
        }
      />

      {/* ── SCORE (SIGNAL) ───────────────────────────────────────────────────────────────────
          The lead figure, attributed to the scorer that owns it. The breakdown beneath is the
          scorer's own `breakdown` array, rendered in its order with its point values. */}
      <section className="mb-11">
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
            detail={score.breakdown.length === 0 ? "nothing matched yet" : "see breakdown"}
          />
        </FactGrid>

        <div className="mt-8 max-w-[520px]">
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
          <QuietEmpty>Nothing recorded about this target yet beyond its name.</QuietEmpty>
        ) : (
          <dl className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
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

      {/* ── NOTES ────────────────────────────────────────────────────────────────────────────── */}
      <section>
        <SectionLabel tier="quiet">Call log &amp; notes</SectionLabel>
        {prospect.body ? (
          <article
            className="prose-ascend max-w-[68ch]"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(prospect.body) }}
          />
        ) : (
          <QuietEmpty>No log entries yet.</QuietEmpty>
        )}
      </section>
    </PageShell>
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
