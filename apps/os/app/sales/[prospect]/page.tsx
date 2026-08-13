import Link from "next/link";
import { notFound } from "next/navigation";
import { renderMarkdown } from "@/lib/renderMarkdown";
import { getProspect, displayName } from "@/lib/sales";
import { compileTargetContext } from "@/lib/compileTargetContext";
import { ScoreBadge } from "@/components/ScoreBadge";
import { StatusBadge } from "@/components/StatusBadge";
import { CopyTargetButton } from "./CopyTargetButton";
import { PromoteButton } from "@/components/PromoteButton";
import { DeleteProspectButton } from "@/components/DeleteProspectButton";

export const dynamic = "force-dynamic";


export default async function ProspectPage({ params }: { params: Promise<{ prospect: string }> }) {
  const { prospect: slug } = await params;
  const prospect = await getProspect(slug);
  if (!prospect) notFound();

  const fm = prospect.frontmatter;
  const payload = compileTargetContext(prospect);

  return (
    <div>
      <div className="mb-2">
        <Link href="/sales" className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          ← hit list
        </Link>
      </div>

      <div className="sticky top-[57px] z-40 -mx-4 mb-6 border-b border-[var(--color-border-hi)] bg-[var(--color-bg)]/85 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">target · {prospect.slug}</p>
              <StatusBadge status={fm.status} />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{displayName(prospect)}</h1>
            <p className="mt-1 font-mono text-xs text-[var(--color-fg-dim)]">
              {[fm.business_type, fm.location].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            <CopyTargetButton payload={payload} />
            <PromoteButton
              prospectSlug={prospect.slug}
              prospectName={displayName(prospect)}
              alreadyWon={fm.status === "closed-won"}
            />
            <DeleteProspectButton
              prospectSlug={prospect.slug}
              prospectName={displayName(prospect)}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6 lg:col-span-1">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-fg-mute)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Priority Score
          </h2>
          <div className="flex flex-col items-center gap-4">
            <ScoreBadge result={prospect.score} size="lg" />
            <div className="w-full">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">why this score</p>
              {prospect.score.breakdown.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {prospect.score.breakdown.map((b) => (
                    <li key={b.key} className="flex items-start gap-2 text-sm">
                      <span className="mt-0.5 inline-flex shrink-0 items-center justify-center rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--color-accent)]">
                        +{b.points}
                      </span>
                      <span className="text-[var(--color-fg)]">{b.label}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-xs text-[var(--color-fg-dim)]">No criteria matched yet — research needed.</p>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6 lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-fg-mute)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Contact &amp; Intel
          </h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <Field label="Contact name" value={fm.contact_name} />
            <Field label="Phone" value={fm.contact_phone} />
            <Field label="Email" value={fm.contact_email} />
            <Field label="Decision-maker access" value={boolish(fm.decision_maker_access)} />
            <Field label="Website" value={fm.website} link />
            <Field label="Website quality" value={fm.website_quality} />
            <Field label="Project urgency" value={fm.project_urgency} />
            <Field label="Niche alignment" value={boolish(fm.niche_alignment)} />
            <Field label="Source" value={fm.source} />
            <Field label="First contact" value={fm.first_contact} />
            <Field label="Last contact" value={fm.last_contact} />
          </dl>
        </section>

        <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-6 lg:col-span-3">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-[var(--color-fg-mute)]">
            <span className="size-1.5 rounded-full bg-[var(--color-accent)]" />
            Call Log &amp; Notes
          </h2>
          {prospect.body ? (
            <article
              className="max-w-none text-sm leading-relaxed text-[var(--color-fg)] [&_a]:text-[var(--color-accent)] [&_code]:rounded [&_code]:bg-[var(--color-surface-hi)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_h2]:mt-4 [&_h2]:font-semibold [&_h2]:text-[var(--color-fg-mute)] [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:mt-1 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(prospect.body) }}
            />
          ) : (
            <p className="font-mono text-xs text-[var(--color-fg-dim)]">No log entries yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function boolish(v: boolean | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v ? "yes" : "no";
}

function Field({ label, value, link }: { label: string; value: unknown; link?: boolean }) {
  const display =
    value === undefined || value === null || value === "" ? "—" : String(value);
  return (
    <div className="flex flex-col">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</dt>
      <dd className="text-sm text-[var(--color-fg)]">
        {link && display !== "—" ? (
          <a href={display} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
            {display}
          </a>
        ) : (
          display
        )}
      </dd>
    </div>
  );
}
