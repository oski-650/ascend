// app/partner — THE PARTNER'S LANDING SURFACE (2G.3, STAGE2G §28.5).
//
// ─── THE PROBLEM IT EXISTS TO SOLVE ────────────────────────────────────────────────────────────
//
// Discovery measured it at `07e7f45`: a partner who accepts an invitation and signs in successfully
// landed on a DENIAL, because `/` demands nine capabilities and a sales principal holds five of the
// system's eighteen — none of the seven `/` needs beyond their own. The invitation primitive was
// production-proven and the person still had nowhere to be.
//
// ─── CAPABILITY-GATED, NOT ROLE-GATED ──────────────────────────────────────────────────────────
//
// There is no `role === "sales"` here, and there is none anywhere: this would have been the first
// role check at a call site in the system, and `core/auth/capabilities` exists so that never
// happens. An OWNER holds a superset and may render this page — that is correct, not a leak. The
// page is "the work that is actually yours" for whoever is asking, and who is asking is decided by
// the database.
//
// ─── IT COPES, IT DOES NOT AUTHORIZE ───────────────────────────────────────────────────────────
//
// `listProspects()` and the knowledge index are guarded at THEIR boundary; this file calls them and
// deals with what comes back. No `can()`, no principal, no capability check — F54 holds it to that,
// and `renderOrDenied` converts a refusal into the denial surface instead of an outage message.
//
// ─── WHY IT REACHES A GUARDED READER AT ALL ────────────────────────────────────────────────────
//
// A landing page that fetched nothing would declare `[]` and be renderable by anyone, including an
// unauthenticated visitor's first authenticated moment before membership resolves. Reaching the
// pipeline through the same guarded reader every other surface uses means this page has a real
// boundary rather than a decorative one.

import type { Metadata } from "next";
import Link from "next/link";
import { listProspects, displayName, statusLabel, type Prospect } from "@/lib/sales";
import { buildKnowledgeIndex } from "@/core/knowledge";
import { routeForEntity } from "@/navigation/routing";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { Status } from "@/components/primitives";
import {
  IndexRow,
  PageShell,
  QuietEmpty,
  SectionLabel,
  SurfaceHeader,
} from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Partner · Ascend OS" };

/** Open pipeline first, then the rest. The reader's own order is preserved within each group. */
const OPEN = (p: Prospect) =>
  p.frontmatter.status !== "closed-won" && p.frontmatter.status !== "closed-lost";

async function PartnerPageContent() {
  // Both are guarded at their own boundary. The index is assembled from the ASKING principal — since
  // slice 4 it takes no argument, so nothing here could widen what it contains even by mistake.
  const [prospects, index] = await Promise.all([listProspects(), buildKnowledgeIndex()]);

  const open = prospects.filter(OPEN);
  const closed = prospects.filter((p) => !OPEN(p));

  return (
    <PageShell>
      <SurfaceHeader
        eyebrow="Partner"
        title="Your pipeline"
        lede={`${open.length} open · ${closed.length} closed · ${index.search.length} searchable objects.`}
      />

      <SectionLabel>Open</SectionLabel>
      {open.length === 0 ? (
        <QuietEmpty>Nothing open right now.</QuietEmpty>
      ) : (
        open.map((p) => <PartnerRow key={p.slug} prospect={p} />)
      )}

      {closed.length > 0 && (
        <>
          <SectionLabel>Closed</SectionLabel>
          {closed.map((p) => <PartnerRow key={p.slug} prospect={p} />)}
        </>
      )}

      <p className="mt-8 text-sm text-[var(--color-t2)]">
        The full pipeline lives on{" "}
        <Link href="/sales" className="underline">
          Pipeline
        </Link>
        . Press ⌘K to search.
      </p>
    </PageShell>
  );
}

function PartnerRow({ prospect }: { prospect: Prospect }) {
  return (
    <IndexRow
      href={routeForEntity("prospect", prospect.slug) ?? undefined}
      name={displayName(prospect)}
      meta={prospect.frontmatter.website ?? undefined}
      state={<Status tone="neutral">{statusLabel(prospect.frontmatter.status)}</Status>}
    />
  );
}

/**
 * THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied.
 *
 * `PartnerPageContent` reaches the data-access layer, which is where `requireCapability` decides. A
 * principal who holds neither `prospects:read` nor `search` gets the denial surface rather than an
 * error page claiming the vault failed.
 */
export default async function PartnerPage(...props: Parameters<typeof PartnerPageContent>) {
  return renderOrDenied("Partner", () => PartnerPageContent(...props));
}
