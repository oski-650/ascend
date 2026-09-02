// core/admin/tools — WHAT THE ADMIN SURFACE IS ALLOWED TO KNOW (2G.4.4, STAGE2G §29.3 Ruling 2).
//
// ─── THIS MODULE EXISTS BECAUSE A PAGE MAY NOT AUTHORIZE ───────────────────────────────────────
//
// `admin`, `admin/import` and `admin/wipe` declared `[]` and rendered for a `sales` principal —
// parked finding 1, and by §29.2(c) not a cosmetic one: `admin/wipe`'s copy names two clients and a
// revenue figure, `clients:*` and `finance:*` material disclosed in MARKUP rather than through a
// reader `sales` is refused elsewhere. §29.6c added the second half: a page demanding nothing also
// renders in full for a REVOKED principal, because revocation is enforced where authority is
// REQUESTED and those pages never requested it.
//
// The fix is not a check in the page — F54 forbids that, and §22's rule is the reason: *the page may
// decide how to respond to denial; it may never decide that denial should occur.* So the copy moves
// behind a data-access boundary that demands `admin:*`, exactly like every other guarded reader in
// this codebase, and the pages become ordinary consumers that cope with the refusal.
//
// ─── A READER THAT LEASES NO CONNECTION, AND WHY THAT IS STILL A BOUNDARY ──────────────────────
//
// `core/auth/directory` wraps `requireCapability` around a connection because it has rows to fetch.
// These three have none — the catalogue is a description of what the tools DO, which is compiled in.
// `requireCapability` is nevertheless the whole boundary and not a formality: it resolves the caller
// through `core/auth/authority`, which for a page render reaches `pageAuthority()` →
// `resolvePrincipal` → the database. A revoked or unmembered principal fails THERE, at the request
// for authority, which is precisely the request §29.6c recorded these pages as never making.
//
// So the data is static and the decision is not.
//
// ─── Q3, ANSWERED BY MOVING RATHER THAN DELETING ───────────────────────────────────────────────
//
// §29.11 Q3 asked whether `admin/wipe`'s target descriptions move behind the guarded reader or are
// deleted. They MOVE. A destructive tool that stops naming what it destroys is a worse tool, and the
// disclosure is closed either way by the page conversion — deleting the copy would pay a real cost
// in operator safety to close nothing extra. The strings are now `admin:*`-only, which is what
// `tests/db/page-matrix-provisioned.test.ts` measures per role rather than assumes.

import "server-only";
import { requireCapability } from "@/core/auth/authority";

/** One entry on the `/admin` index: what it does, and whether it can be undone. */
export type AdminTool = {
  readonly href: string;
  readonly title: string;
  readonly desc: string;
  readonly consequence: string;
  readonly destructive: boolean;
};

/** One mappable column on the CSV import surface. */
export type ImportField = {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly required?: boolean;
};

const ADMIN_TOOLS: readonly AdminTool[] = [
  {
    href: "/admin/import",
    title: "Bulk import prospects",
    desc: "Paste a CSV export, map its columns, and write one markdown file per row into 02 - Sales & Hit List/.",
    consequence: "Additive — writes new prospect files, changes nothing that exists.",
    destructive: false,
  },
  {
    href: "/admin/wipe",
    title: "Wipe demo data",
    desc: "Clear the transactional sidecars — invoices, time log, audits, approvals — and the seeded sample documents.",
    consequence: "Irreversible. There is no undo short of iCloud version history.",
    destructive: true,
  },
];

const IMPORT_FIELDS: readonly ImportField[] = [
  { key: "name", label: "Business name", hint: "Required. Becomes the prospect filename slug.", required: true },
  { key: "business_type", label: "Business type", hint: "e.g. Roofing, HVAC, Cleaning" },
  { key: "location", label: "Location", hint: "City, state, region" },
  { key: "status", label: "Status", hint: "lead, contacted, proposal, closed-won, closed-lost" },
  { key: "website", label: "Website URL", hint: "" },
  { key: "website_quality", label: "Website quality", hint: "none, outdated, acceptable, modern" },
  { key: "decision_maker_access", label: "DM access (bool)", hint: "true/yes/1 or false/no/0" },
  { key: "project_urgency", label: "Project urgency", hint: "low / medium / high" },
  { key: "niche_alignment", label: "Niche alignment (bool)", hint: "true/yes/1" },
  { key: "contact_name", label: "Contact name", hint: "" },
  { key: "contact_phone", label: "Contact phone", hint: "" },
  { key: "contact_email", label: "Contact email", hint: "" },
  { key: "source", label: "Source", hint: "How you found them" },
  { key: "notes", label: "Notes / friction", hint: "Free-text notes for the markdown body" },
];

// ─── THE WIPE CATALOGUE IS THE ONE DEFINITION OF WHAT MAY BE WIPED ─────────────────────────────
//
// It was two: `app/api/admin/wipe/route.ts` held the permitted id list, and the page held an
// independent copy carrying the labels. Two lists that must agree and nothing asserting they do is
// how a target ends up selectable in the UI and refused by the route. The route now derives its
// permitted set from `WIPE_TARGET_IDS` below, so the catalogue and the validator cannot disagree.
const WIPE_TARGET_GROUPS = [
  {
    group: "Transactional sidecars (recommended)",
    items: [
      { key: "invoices", label: "Empty invoices.jsonl", sub: "Wipes the seeded $4,541 revenue + care plans + overdue", defaultOn: true },
      { key: "time_log", label: "Empty time_log.jsonl", sub: "Wipes 22h of seeded time entries + EHR history", defaultOn: true },
      { key: "audits", label: "Empty audits.jsonl", sub: "Wipes 6-month Lighthouse trend (including any real PSI runs)", defaultOn: true },
      { key: "automations_fired", label: "Empty automations_fired.jsonl", sub: "Resets pending firings — they'll re-appear as pending", defaultOn: true },
      { key: "portal_submissions", label: "Empty portal_submissions.jsonl", sub: "Wipes any test onboarding submissions", defaultOn: true },
      { key: "approval_requests", label: "Empty approval_requests.jsonl", sub: "Wipes Pilar's 2 seeded signed approvals + any test ones", defaultOn: true },
      { key: "portal_invites", label: "Empty portal_invites.jsonl", sub: "REVOKES ALL invite tokens — you'll need to issue new ones", defaultOn: false },
    ],
  },
  {
    group: "Sample documents & uploads",
    items: [
      { key: "sample_documents", label: "Delete seeded Pilar + Tapia document trees", sub: "Removes proposals, contracts, SOWs from 04 - Documents/", defaultOn: true },
      { key: "client_uploads", label: "Delete seeded client upload dirs", sub: "Removes the per-client folders under 05 - Client Uploads/", defaultOn: true },
    ],
  },
  {
    group: "CRM client folders — DESTRUCTIVE",
    items: [
      { key: "delete_client_pilar", label: "Delete decoraciones-pilar CRM folder", sub: "Removes the entire client profile. Only check this if you're NOT keeping Pilar as a real client.", defaultOn: false },
      { key: "delete_client_tapia", label: "Delete tapia-tile-marble CRM folder", sub: "Removes the entire client profile. Only check this if you're NOT keeping Tapia as a real client.", defaultOn: false },
    ],
  },
] as const;

/** Every id the wipe route will act on. Anything outside this set is refused there. */
export type WipeTargetId = (typeof WIPE_TARGET_GROUPS)[number]["items"][number]["key"];

/** One selectable wipe target, as the operator surface needs it. */
export type WipeTargetItem = {
  readonly key: WipeTargetId;
  readonly label: string;
  /** What it destroys, in words. Named plainly on purpose — see the Q3 note in this file's header. */
  readonly sub: string;
  readonly defaultOn: boolean;
};

/** A visual grouping of wipe targets. Presentation only; it carries no authorization meaning. */
export type WipeTargetGroup = {
  readonly group: string;
  readonly items: readonly WipeTargetItem[];
};

/** The permitted target ids, derived from the catalogue rather than retyped beside it. */
export const WIPE_TARGET_IDS: readonly WipeTargetId[] =
  WIPE_TARGET_GROUPS.flatMap((g) => g.items.map((i) => i.key));

/** The `/admin` index, for a caller holding `admin:*`. */
export async function listAdminTools(): Promise<readonly AdminTool[]> {
  await requireCapability("admin:*");
  return ADMIN_TOOLS;
}

/** The CSV import field map, for a caller holding `admin:*`. */
export async function listImportFields(): Promise<readonly ImportField[]> {
  await requireCapability("admin:*");
  return IMPORT_FIELDS;
}

/**
 * What the wipe tool may destroy, described, for a caller holding `admin:*`.
 *
 * This is the reader §29.3 Ruling 2's content rule names: the client names and the revenue figure
 * reach the browser through THIS call or not at all.
 */
export async function listWipeTargets(): Promise<readonly WipeTargetGroup[]> {
  await requireCapability("admin:*");
  return WIPE_TARGET_GROUPS;
}
