// components/ProfileSection — a client's vault profile prose.
//
// Migrated from the retired /crm/[client] surface. What it renders is unchanged: the frontmatter
// table and the markdown body of one profile file (business_context / brand_identity /
// project_scope), plus structural_meta.json.
//
// WHAT CHANGED IS THE GRAMMAR. It was three boxed cards in a grid, each with an accent bullet and
// an uppercase heading — the densest chrome on the old page wrapped around what is, in fact, the
// quietest content in the product. Profile prose is reference material: it is what the operator
// reads to remember who a client is, not something they act on. So it is now a disclosure that
// opens into hairline-separated metadata and `.prose-ascend` body text, and it stays closed until
// asked for.
//
// It renders; it derives nothing. `renderMarkdown` and the Client reader are unchanged.

import type { Frontmatter, ProfileSection as ProfileSectionData } from "@/core/crm";
import { renderMarkdown } from "@/lib/renderMarkdown";

function stringify(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

/** Frontmatter as a definition list. Empty values are dropped rather than rendered as em-dashes. */
function MetaRows({ data }: { data: Frontmatter }) {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return null;
  return (
    <dl className="flex flex-col">
      {entries.map(([k, v]) => (
        <div
          key={k}
          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-[var(--color-line)] py-2 last:border-b-0"
        >
          <dt className="t-label shrink-0 text-[var(--color-t3)]">{k.replace(/_/g, " ")}</dt>
          <dd className="t-body min-w-0 break-words text-right text-[var(--color-t1)]">
            {stringify(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One profile file, as a disclosure.
 *
 * `defaultOpen` exists because business context is the section an operator actually wants on
 * arrival; brand and scope are consulted, not read.
 */
export function ProfileSection({
  title,
  section,
  defaultOpen = false,
}: {
  title: string;
  section: ProfileSectionData;
  defaultOpen?: boolean;
}) {
  const hasBody = !section.missing && section.body.length > 0;
  const fieldCount = section.missing
    ? 0
    : Object.entries(section.frontmatter).filter(([, v]) => v !== undefined && v !== null && v !== "")
        .length;

  return (
    <details open={defaultOpen && !section.missing} className="group border-b border-[var(--color-line)]">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-3">
        <span className="t-body flex items-baseline gap-2 text-[var(--color-t2)] transition-colors duration-[120ms] group-hover:text-[var(--color-t1)]">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          {title}
        </span>
        {/* An honest state line: a missing file says so rather than opening onto nothing. */}
        <span className="t-mono shrink-0 text-[var(--color-t3)]">
          {section.missing
            ? "not yet created"
            : [fieldCount > 0 && `${fieldCount} fields`, hasBody && "notes"].filter(Boolean).join(" · ") ||
              "empty"}
        </span>
      </summary>

      {!section.missing && (
        <div className="pb-5">
          <MetaRows data={section.frontmatter} />
          {hasBody && (
            <article
              className="prose-ascend mt-4 max-w-[68ch]"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.body) }}
            />
          )}
        </div>
      )}
    </details>
  );
}

/** structural_meta.json — identity anchors (client_id, tier, status). Fields only, no prose. */
export function MetaSection({ data, missing }: { data: Frontmatter; missing: boolean }) {
  return (
    <details className="group border-b border-[var(--color-line)]">
      <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-3">
        <span className="t-body flex items-baseline gap-2 text-[var(--color-t2)] transition-colors duration-[120ms] group-hover:text-[var(--color-t1)]">
          <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
            ▸
          </span>
          Structural metadata
        </span>
        <span className="t-mono shrink-0 text-[var(--color-t3)]">
          {missing ? "not yet created" : "structural_meta.json"}
        </span>
      </summary>
      {!missing && (
        <div className="pb-5">
          <MetaRows data={data} />
        </div>
      )}
    </details>
  );
}