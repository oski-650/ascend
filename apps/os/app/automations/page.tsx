// app/automations — THE INFRASTRUCTURE SURFACE.
//
// Plumbing, not a product demo. It answers exactly four questions per rule: what exists, what
// triggers it, what it does, and when it last ran. Nothing more, because nothing more is recorded.
//
// HONESTY CONSTRAINTS observed here:
//   • There is NO enabled/disabled flag on AutomationRule. Presence of the markdown file IS the
//     armed state, so the page says that rather than rendering a toggle that controls nothing.
//   • Ascend runs DRY-RUN by design: a firing produces a payload for the operator to send. That is
//     stated once as a property of the layer, not as a KPI card.
//   • Execution state is only what `automations_fired.jsonl` contains — a timestamp and a context.
//     No success rates, no run durations, no reliability scores. None of that is recorded, so none
//     of it is displayed.
//
// Rules are read by `detectFirings()` (lib/automations), which owns matching entirely. The surface
// evaluates no trigger and matches no condition.

import Link from "next/link";
import type { Metadata } from "next";
import { detectFirings, type TriggerContext } from "@/lib/automations";
import { routeForEntity } from "@/navigation/routing";
import { NODE_VISUAL } from "@/graph-view/taxonomy";
import { PendingFiringCard } from "@/components/PendingFiringCard";
import {
  FactGrid,
  FactRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Automations · Ascend OS" };

/** Trigger type → the plain sentence describing when it fires. A vocabulary map, not logic. */
const TRIGGER_LABEL: Record<string, string> = {
  "invoice.paid": "an invoice is marked paid",
  "production.phase_completed": "a build phase completes",
  "production.launch_buffer_in": "a launch date enters its buffer window",
  "prospect.status_is": "a prospect reaches a pipeline status",
};

/**
 * How many automations fired in the last 7 days.
 *
 * The clock read lives here rather than in the component body: react-hooks/purity forbids calling
 * an impure function (Date.now) during render. Entries with a missing or unparseable `fired_at` are
 * excluded rather than counted, matching the reader posture elsewhere — skip, never fabricate.
 */
function countFiredThisWeek(fired: { fired_at?: string }[]): number {
  const weekAgo = Date.now() - 7 * 86400_000;
  return fired.filter((f) => {
    const t = f.fired_at ? new Date(f.fired_at).getTime() : NaN;
    return Number.isFinite(t) && t >= weekAgo;
  }).length;
}

/**
 * The canonical route for whatever a firing is about.
 *
 * The trigger context already carries the real slug (`client_slug` / `prospect_slug`) — it is what
 * the rule matched on — so this reads an existing field and hands it to navigation/routing, the
 * single owner of entity→route knowledge. It invents no id and constructs no URL: a context naming
 * no routable subject returns null and the target renders as plain text.
 */
function targetHref(ctx: TriggerContext): string | null {
  const client = ctx.client_slug;
  if (typeof client === "string" && client.length > 0) return routeForEntity("client", client);
  const prospect = ctx.prospect_slug;
  if (typeof prospect === "string" && prospect.length > 0) return routeForEntity("prospect", prospect);
  return null;
}

function shortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export default async function AutomationsPage() {
  const { pending, fired, rules } = await detectFirings();

  const firedThisWeek = countFiredThisWeek(fired);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const recentFires = [...fired]
    .sort((a, b) => (b.fired_at ?? "").localeCompare(a.fired_at ?? ""))
    .slice(0, 10);

  return (
    <PageShell hue={NODE_VISUAL.sop.color}>
      <SurfaceHeader
        eyebrow="Infrastructure"
        title="Automations"
        lede="Rules that watch the vault and prepare work for you. Ascend never sends on your behalf — a firing produces a payload, you decide whether it goes out."
      />

      {/* ── STATE ────────────────────────────────────────────────────────────────────────────
          Pending firings lead because they are the only thing here that is waiting on a person. */}
      <section className="mb-14">
        <FactGrid
          lead={
            <FactRow
              lead
              value={String(pending.length)}
              label={pending.length === 1 ? "Firing waiting" : "Firings waiting"}
              detail={pending.length === 0 ? "nothing needs sending" : "each has a payload ready"}
              tone={pending.length > 0 ? "accent" : undefined}
            />
          }
        >
          <FactRow
            value={String(rules.length)}
            label="Rules armed"
            detail="every rule file is live"
          />
          <FactRow
            value={String(firedThisWeek)}
            label="Fired · 7d"
            detail={`${fired.length} all time`}
          />
        </FactGrid>
      </section>

      {/* ── WAITING ON YOU ─────────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <SectionLabel
          tier={pending.length > 0 ? "decision" : "primary"}
          aside={pending.length > 0 ? `${pending.length} ready` : undefined}
        >
          Waiting on you
        </SectionLabel>

        {pending.length === 0 ? (
          <QuietEmpty>
            No rule conditions currently match, or everything that matched has been marked done.
          </QuietEmpty>
        ) : (
          <div className="flex flex-col">
            {pending.map((f) => (
              <PendingFiringCard
                key={f.firing_id}
                firing_id={f.firing_id}
                rule_id={f.rule.id}
                rule_name={f.rule.name}
                trigger_type={f.rule.trigger.type}
                clipboard_label={f.rule.clipboard_label}
                target_summary={f.targetSummary}
                target_href={targetHref(f.context)}
                payload={f.payload}
                context={f.context}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── THE RULES ──────────────────────────────────────────────────────────────────────
          One line of prose per rule: when it fires, what it produces. A list, not a card grid —
          these are peers and the point is to scan them. */}
      <section className="mb-14">
        <SectionLabel tier="primary" aside={`${rules.length} installed`}>
          Rules
        </SectionLabel>

        {rules.length === 0 ? (
          <QuietEmpty>
            No rules installed. Add markdown files with YAML frontmatter to{" "}
            <span className="t-mono">03 - SOP Library/automations/</span> — see{" "}
            <span className="t-mono">_template.md</span>.
          </QuietEmpty>
        ) : (
          <ul className="flex flex-col">
            {rules.map((r) => {
              const runs = fired.filter((f) => f.rule_id === r.id);
              const last = runs.sort((a, b) => (b.fired_at ?? "").localeCompare(a.fired_at ?? ""))[0];
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-x-6 gap-y-1.5 border-b border-[var(--color-line)] py-4 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <div className="min-w-0">
                    <h3 className="t-body text-[var(--color-t1)]">{r.name}</h3>
                    <p className="t-meta mt-0.5 max-w-[68ch] text-[var(--color-t2)]">
                      Fires when {TRIGGER_LABEL[r.trigger.type] ?? r.trigger.type.replace(/[._]/g, " ")}
                      {r.description ? ` — ${r.description}` : ""}
                    </p>
                    <p className="t-mono mt-1 text-[var(--color-t3)]">
                      {r.id} · produces &ldquo;{r.clipboard_label}&rdquo;
                    </p>
                  </div>
                  <p className="t-mono shrink-0 text-[var(--color-t3)] sm:text-right">
                    {runs.length === 0
                      ? "never fired"
                      : `fired ${runs.length}× · last ${shortDateTime(last.fired_at)}`}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── EXECUTION LOG ─────────────────────────────────────────────────────────────────── */}
      {recentFires.length > 0 && (
        <section>
          <SectionLabel tier="quiet" aside={`${fired.length} all time`}>
            Recent fires
          </SectionLabel>
          <ul className="flex flex-col">
            {recentFires.map((f) => {
              const rule = ruleById.get(f.rule_id);
              const target =
                (f.context.client_name as string | undefined) ??
                (f.context.prospect_name as string | undefined) ??
                f.firing_id.split("::")[1] ??
                "—";
              const href = targetHref(f.context);
              return (
                <li
                  key={f.firing_id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-[var(--color-line)] py-2.5 last:border-b-0"
                >
                  <span className="t-mono w-[76px] shrink-0 text-[var(--color-t3)]">
                    {shortDateTime(f.fired_at)}
                  </span>
                  <span className="t-body min-w-0 flex-1 text-[var(--color-t2)]">
                    {rule?.name ?? f.rule_id}
                  </span>
                  <span className="t-mono shrink-0 text-[var(--color-t3)]">
                    {href ? (
                      <Link
                        href={href}
                        className="transition-colors duration-[120ms] hover:text-[var(--color-accent)]"
                      >
                        {target}
                      </Link>
                    ) : (
                      target
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="t-mono mt-10 text-[var(--color-t3)]">
        Rules live in <span className="text-[var(--color-t2)]">03 - SOP Library/automations/*.md</span>.
        Deleting a file retires the rule — there is no enable switch.
      </p>
    </PageShell>
  );
}