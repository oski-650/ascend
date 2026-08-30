// app/maintenance — THE LIFECYCLE SURFACE.
//
// Ongoing service state for sites already launched: who is on a care retainer, and what condition
// their site is actually in.
//
// WHAT CHANGED ARCHITECTURALLY (a duplication retirement, not a new capability):
// this page used to classify Lighthouse scores itself — `>=90 healthy · 50–89 watch · <50 below
// baseline` — which is the frozen Site Quality Engine's job, with the identical thresholds. The
// engine was already orchestrated by `mission-control/site-quality.ts` and had ZERO consumers.
// Classification and the poor/needs-improvement/good counts now come from it. The surface no longer
// classifies anything.
//
// ALSO REMOVED: the hand-rolled "avg latest perf" (an average nothing owns and nobody acts on) and
// the "stale >30d" tile (a 30-day maintenance threshold invented on the surface with no owner in
// the domain). Each site now simply states when it was last audited — a fact, not a verdict.

import type { Metadata } from "next";
import { listCareClients } from "@/core/finance";
import { listAudits, historyFor } from "@/lib/audits";
import { assembleSiteQuality } from "@/mission-control";
import { compileMaintenanceBrief } from "@/lib/compileMaintenanceBrief";
import { routeForEntity } from "@/navigation/routing";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { AuditClientCard, type StrategyView } from "@/components/AuditClientCard";
import { CopyTextButton } from "@/components/CopyTextButton";
import {
  FactGrid,
  FactRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Maintenance · Ascend OS" };

/** How many runs a sparkline shows. A presentation limit. */
const HISTORY_DEPTH = 8;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

async function MaintenancePageContent() {
  const [clients, allAudits, quality, brief] = await Promise.all([
    listCareClients(),
    listAudits(),
    assembleSiteQuality(), // Mission Control invokes the Site Quality Engine — never the surface
    compileMaintenanceBrief(),
  ]);

  // Key the engine's per-site verdicts by client+strategy. A lookup, not a derivation.
  const qualityBy = new Map(quality.sites.map((s) => [`${s.clientSlug}:${s.strategy}`, s]));

  const histories = await Promise.all(
    clients.map(async (c) => ({
      slug: c.slug,
      mobile: await historyFor(c.slug, "mobile", HISTORY_DEPTH),
      desktop: await historyFor(c.slug, "desktop", HISTORY_DEPTH),
    }))
  );
  const historyBySlug = new Map(histories.map((h) => [h.slug, h]));

  const retainers = clients.filter((c) => c.retainer_active);
  const recentAudits = allAudits.slice(0, 10);

  return (
    <PageShell hue={NODE_VISUAL.care_plan.color}>
      <SurfaceHeader
        eyebrow="Lifecycle"
        title="Maintenance"
        lede="Sites Ascend keeps running after launch — retainer state, and what each site's last audit found."
        actions={
          <CopyTextButton payload={brief} label="Copy maintenance brief" variant="secondary" />
        }
      />

      {/* ── STATE ────────────────────────────────────────────────────────────────────────────
          Retainers lead — that is the commercial fact. Site condition is the SIGNAL beside it, and
          it names the engine that classified it. */}
      <section className="mb-14">
        <FactGrid
          lead={
            <FactRow
              lead
              value={String(retainers.length)}
              label={retainers.length === 1 ? "Active retainer" : "Active retainers"}
              detail={`${clients.length - retainers.length} of ${clients.length} clients not on care`}
            />
          }
        >
          <FactRow
            value={String(quality.counts.poor)}
            label="Poor"
            detail="a category below 50"
            attribution="Site Quality Engine"
            tone={quality.counts.poor > 0 ? "risk" : undefined}
          />
          <FactRow
            value={String(quality.counts.needsImprovement)}
            label="Needs work"
            detail="worst category 50–89"
            attribution="Site Quality Engine"
            tone={quality.counts.needsImprovement > 0 ? "accent" : undefined}
          />
          <FactRow
            value={String(quality.counts.good)}
            label="Good"
            detail="every category ≥ 90"
            attribution="Site Quality Engine"
            tone={quality.counts.good > 0 ? "good" : undefined}
          />
        </FactGrid>
      </section>

      {/* ── SITES UNDER CARE ─────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionLabel
          tier="primary"
          aside={`${clients.length} site${clients.length === 1 ? "" : "s"} · ${quality.sites.length} audited`}
        >
          Sites
        </SectionLabel>

        {clients.length === 0 ? (
          <QuietEmpty>
            No clients yet, so nothing is under care. Add a client and set its{" "}
            <span className="t-mono">website</span> to start auditing.
          </QuietEmpty>
        ) : (
          <div className="flex flex-col">
            {clients.map((c) => {
              const h = historyBySlug.get(c.slug) ?? { mobile: [], desktop: [] };
              const mobile: StrategyView = {
                quality: qualityBy.get(`${c.slug}:mobile`) ?? null,
                history: h.mobile,
              };
              const desktop: StrategyView = {
                quality: qualityBy.get(`${c.slug}:desktop`) ?? null,
                history: h.desktop,
              };
              return (
                <AuditClientCard key={c.slug} client={c} mobile={mobile} desktop={desktop} />
              );
            })}
          </div>
        )}
      </section>

      {/* ── AUDIT LOG ─────────────────────────────────────────────────────────────────────── */}
      {recentAudits.length > 0 && (
        <section>
          <SectionLabel tier="quiet" aside={`${allAudits.length} all time`}>
            Recent audits
          </SectionLabel>
          <ul className="flex flex-col">
            {recentAudits.map((a) => {
              const href = routeForEntity("client", a.client);
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
                >
                  <span className="t-mono w-[76px] shrink-0 text-[var(--color-t3)]">
                    {shortDate(a.run_at)}
                  </span>
                  <span className="t-body min-w-0 flex-1 text-[var(--color-t2)]">
                    {href ? (
                      <a
                        href={href}
                        className="transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                      >
                        {a.client}
                      </a>
                    ) : (
                      a.client
                    )}
                  </span>
                  <span className="t-mono shrink-0 text-[var(--color-t3)]">{a.strategy}</span>
                  <span className="t-mono w-[112px] shrink-0 text-right tabular-nums text-[var(--color-t2)]">
                    perf {a.scores.performance ?? "—"} · seo {a.scores.seo ?? "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `MaintenancePageContent` reaches the data-access layer, which is where `requireCapability` decides. If the
 * answer is no, this renders the denial surface instead of letting a `CapabilityDenied` reach
 * `app/error.tsx`, which would report an authorization refusal as a failure to read the vault.
 * Every other throw — an outage, a malformed record, `notFound()` — passes straight through.
 */
export default async function MaintenancePage(...props: Parameters<typeof MaintenancePageContent>) {
  return renderOrDenied("Maintenance", () => MaintenancePageContent(...props));
}
