// app/signals — THE DECISIONAL SURFACE.
//
// The clearest expression of the FACT → SIGNAL → DECISION → ACTION grammar in the product:
//
//   DECISION  what Ascend thinks matters   → mission-control.assemblePriorityFeed()
//   SIGNAL    what Ascend detected          → lib/opportunities.detectOpportunities()
//   ACTION    what the operator can do      → links + the existing clipboard briefs
//
// The surface RANKS NOTHING. Decision's order is consumed verbatim and its `explanation` is never
// paraphrased. `rank()` is never imported (F14 is absolute); severity grouping below is the
// producer's own field, used for presentation order only.
//
// Previously this page never consulted the Decision Engine at all — it grouped raw opportunities by
// severity and stopped there. The ranked layer is what makes it decisional rather than a list.

import Link from "next/link";
import { detectOpportunities, severityLabel, type Severity } from "@/lib/opportunities";
import { compileOpportunityBrief } from "@/lib/compileOpportunityBrief";
import { compileOperatorBrief } from "@/lib/compileOperatorBrief";
import {
  assembleFiringSignals,
  assembleNotifications,
  assemblePriorityFeed,
  partitionNotifications,
} from "@/mission-control";
import {
  dismissNotificationAction,
  snoozeNotificationAction,
  viewNotificationAction,
} from "./actions";
import { routeForEntity } from "@/navigation/routing";
import { focusHrefFor } from "@/graph-view/contract";
import { CopyTextButton } from "@/components/CopyTextButton";
import { Badge, Button, Status, type Tone } from "@/components/primitives";
import {
  AttentionItem,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

/** Presentation order. Mirrors the producer's own severity vocabulary; it re-ranks nothing. */
const SECTION_ORDER: Severity[] = ["urgent", "suggest", "info"];

const SEVERITY_TONE: Record<Severity, Tone> = {
  urgent: "risk",
  suggest: "accent",
  info: "neutral",
};

async function SignalsPageContent() {
  const [opportunities, operatorPayload, priority, firing] = await Promise.all([
    detectOpportunities(),
    compileOperatorBrief(),
    assemblePriorityFeed(),
    assembleFiringSignals(),
  ]);

  // The attention queue is the assembler's output, consumed AS-IS. This surface decides nothing
  // about notifications: what counts as "needs attention" is `partitionNotifications`, owned by
  // mission-control and expressing the ENGINE'S documented status semantics. Rebuilding that
  // judgement here — a hand-rolled predicate over status — is the boundary F14 exists to prevent,
  // and is exactly the shape that produced the earlier eight-engine miscount.
  // BOTH channels reach the queue. Indeterminate signals carry no score and never enter rank(),
  // but "health cannot be determined" is actionable — it tells the operator what to investigate —
  // so it keeps the full lifecycle. The notification engine reads no score, so this needs no
  // special case: it is the ranking boundary that excludes them, not the attention boundary.
  const { open: openQueue, suppressed } = partitionNotifications(
    await assembleNotifications([...firing.rankable, ...firing.indeterminate])
  );

  // Per-opportunity clipboard payloads are compiled server-side so client buttons receive strings.
  const withPayload = await Promise.all(
    opportunities.map(async (o) => ({ opp: o, payload: await compileOpportunityBrief(o) }))
  );

  const grouped: Record<Severity, typeof withPayload> = { urgent: [], suggest: [], info: [] };
  for (const x of withPayload) grouped[x.opp.severity].push(x);

  const urgentCount = grouped.urgent.length;

  return (
    // Accent field: this is the attention surface, and accent is the operator-attention accent.
    <PageShell hue="var(--color-accent)">
      <SurfaceHeader
        eyebrow="Intelligence"
        title="Signals"
        lede="What Ascend has detected, and what it believes deserves your attention first."
        actions={
          <CopyTextButton
            payload={operatorPayload}
            label="Copy operator brief"
            variant="secondary"
          />
        }
      />

      {/* ── ATTENTION ────────────────────────────────────────────────────────────────────────
          The only section on this page where the operator can FINISH something. Everything else
          here informs; this closes the loop — discover, act, and the action becomes a fact in the
          spine, because each button delegates to a core writer that already emits its own event. */}
      <section className="mb-14">
        <SectionLabel
          tier="decision"
          aside={
            suppressed.length > 0
              ? `${openQueue.length} open · ${suppressed.length} handled`
              : openQueue.length > 0
                ? `${openQueue.length} open`
                : undefined
          }
        >
          Needs attention
        </SectionLabel>

        {openQueue.length === 0 ? (
          <QuietEmpty>
            Nothing awaiting a decision. Snoozed items return on their own when the snooze expires.
          </QuietEmpty>
        ) : (
          openQueue.map((n) => {
            const href = routeForEntity(n.subject.entity as Parameters<typeof routeForEntity>[0], n.subject.id);
            return (
              <div
                key={n.signalKey}
                className="flex flex-wrap items-baseline justify-between gap-4 border-b border-[var(--color-line)] py-4"
              >
                <div className="min-w-0">
                  <p className="t-body text-[var(--color-t1)]">{n.title}</p>
                  <p className="t-label mt-1 text-[var(--color-t3)]">
                    {n.subject.name}
                    {n.status === "viewed" ? " · seen" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {href && (
                    <form action={viewNotificationAction}>
                      <input type="hidden" name="signalKey" value={n.signalKey} />
                      <input type="hidden" name="fingerprint" value={n.fingerprint} />
                      <input type="hidden" name="href" value={href} />
                      <Button variant="primary" type="submit">
                        Open {n.subject.entity}
                      </Button>
                    </form>
                  )}
                  <form action={snoozeNotificationAction}>
                    <input type="hidden" name="signalKey" value={n.signalKey} />
                    <input type="hidden" name="fingerprint" value={n.fingerprint} />
                    <Button variant="ghost" type="submit">
                      Snooze
                    </Button>
                  </form>
                  <form action={dismissNotificationAction}>
                    <input type="hidden" name="signalKey" value={n.signalKey} />
                    <input type="hidden" name="fingerprint" value={n.fingerprint} />
                    <Button variant="ghost" type="submit">
                      Dismiss
                    </Button>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </section>

      {/* ── DECISION ─────────────────────────────────────────────────────────────────────────
          Ranked by the Decision Engine. This dominates the page through hierarchy — scale,
          an accent rule, and position — not by becoming a large card. */}
      <section className="mb-14">
        <SectionLabel
          tier="decision"
          aside={priority.length > 0 ? `${priority.length} ranked` : undefined}
        >
          What matters most
        </SectionLabel>

        {priority.length === 0 ? (
          <QuietEmpty>
            Nothing ranked right now. No open health risks or opportunities across the portfolio.
          </QuietEmpty>
        ) : (
          priority.map((item) => {
            const href = routeForEntity(item.subject.entity, item.subject.id);
            // Graph identity from the contract that owns it. This used to be a hand-built
            // `${entity}:${id}` template, which meant the button was offered even for subjects the
            // graph cannot represent — `focusHrefFor` returns null for those and it disappears.
            const focusHref = focusHrefFor(item.subject.entity, item.subject.id);
            return (
              <AttentionItem
                key={`${item.subject.entity}:${item.subject.id}:${item.rank}`}
                rank={item.rank}
                subject={item.subject.name}
                explanation={item.explanation.replace(/^because:\s*/i, "")}
                actions={
                  <>
                    {focusHref && (
                      <Link href={focusHref} className="contents">
                        <Button variant="ghost">Focus in graph</Button>
                      </Link>
                    )}
                    {href && (
                      <Link
                        href={href}
                        className="t-label text-[var(--color-t3)] transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                      >
                        Open {item.subject.entity} →
                      </Link>
                    )}
                  </>
                }
              />
            );
          })
        )}
      </section>

      {/* ── SIGNAL ───────────────────────────────────────────────────────────────────────────
          Everything detected, in the producer's severity order. Quieter than the ranked layer
          by design: these are observations, not conclusions. */}
      <section>
        <SectionLabel
          tier="primary"
          aside={
            withPayload.length === 0
              ? undefined
              : `${withPayload.length} detected${urgentCount > 0 ? ` · ${urgentCount} urgent` : ""}`
          }
        >
          What Ascend detected
        </SectionLabel>

        {withPayload.length === 0 ? (
          <QuietEmpty>
            The system is quiet — nothing firing. No urgent projects, cold proposals, or untouched
            hot leads.
          </QuietEmpty>
        ) : (
          <div className="flex flex-col gap-10">
            {SECTION_ORDER.map((sev) => {
              const items = grouped[sev];
              if (items.length === 0) return null;
              return (
                <div key={sev}>
                  <div className="mb-3 flex items-baseline gap-2.5">
                    <Status tone={SEVERITY_TONE[sev]}>{severityLabel(sev)}</Status>
                    <span className="t-mono text-[var(--color-t3)]">{items.length}</span>
                  </div>

                  <ul className="flex flex-col">
                    {items.map(({ opp, payload }) => {
                      const target = opp.target;
                      const href = target ? routeForEntity(target.kind, target.slug) : null;
                      return (
                        <li
                          key={opp.id}
                          className="border-b border-[var(--color-line)] py-4 last:border-b-0"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <h3 className="t-h2 min-w-0 max-w-[62ch] text-[var(--color-t1)]">
                              {opp.title}
                            </h3>
                            {target && <Badge>{target.kind}</Badge>}
                          </div>

                          {/* The engine's own rationale — rendered verbatim, never paraphrased. */}
                          <p className="t-body mt-1.5 max-w-[68ch] text-[var(--color-t2)]">
                            {opp.rationale}
                          </p>

                          {/* The engine's recommended next step. Content, not an affordance, so it
                              gets its own line above the actions rather than sitting beside them. */}
                          <p className="t-meta mt-1.5 max-w-[68ch] text-[var(--color-t3)]">
                            <span className="t-label text-[var(--color-t3)]">Next</span> {opp.action}
                          </p>

                          <p className="t-mono mt-2 text-[var(--color-t3)]">
                            ↳ Opportunity Engine · {opp.kind.replace(/_/g, " ")}
                          </p>

                          {/* ACTION — the only interactive layer. */}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {href && target && (
                              <Link href={href} className="contents">
                                <Button variant="ghost">Open {target.kind}</Button>
                              </Link>
                            )}
                            <CopyTextButton payload={payload} label="Copy brief" variant="ghost" />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PageShell>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `SignalsPageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function SignalsPage(...props: Parameters<typeof SignalsPageContent>) {
  return renderOrDenied("Signals", () => SignalsPageContent(...props));
}
