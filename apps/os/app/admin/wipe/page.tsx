// app/admin/wipe — THE DESTRUCTIVE VAULT SURFACE (2G.4.4, STAGE2G §29.3 Ruling 2).
//
// This page is parked finding 1's worst case and the reason §29.2(c) reclassified that finding from
// "no data leaks" to a live disclosure: as a `"use client"` page declaring `[]`, its static copy
// named two clients and a $4,541 revenue figure — `clients:*` and `finance:*` material — in MARKUP,
// to a `sales` principal refused that material everywhere else. Unexploitable only because
// `users = 1`.
//
// The copy now arrives through `listWipeTargets()`, which requires `admin:*`. §29.11 Q3 is answered
// by moving it rather than deleting it: the tool keeps saying what it destroys, to the people
// allowed to destroy it.
//
// ─── IT COPES, IT DOES NOT AUTHORIZE ───────────────────────────────────────────────────────────
//
// The route this page's panel posts to authorizes separately and identically (`authorize(req,
// "admin:*")`). Neither trusts the other; the page decides nothing.

import type { Metadata } from "next";
import { listWipeTargets } from "@/core/admin/tools";
import { WipePanel } from "@/components/admin/WipePanel";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Wipe demo data · Ascend OS" };

async function WipePageContent() {
  // ALONE, and first — see the sibling note in app/admin/import/page.tsx.
  const groups = await listWipeTargets();
  return <WipePanel groups={groups} />;
}

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function WipePage(...props: Parameters<typeof WipePageContent>) {
  return renderOrDenied("Wipe demo data", () => WipePageContent(...props));
}
