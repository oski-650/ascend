// core/crm/promote.ts — prospect → client promotion, SOURCE-CORRECT (Dependency D1a).
//
// Owns the CRM side ONLY: build the 4 party-layer files, create the client, mark the prospect
// promoted IN THE STORE THAT OWNS IT, and record the promotion on that store's event spine.
// Production scaffolding stays a route concern.
//
// ─── WHAT D1a CHANGED, AND WHY ─────────────────────────────────────────────────────────────────
//
// This module used to read the prospect through the canonical reader (Postgres, in the deployed
// configuration) and then mark a VAULT hit-list file. Measured against production's shape, that is
// not a near-miss: 3,102 of 3,108 prospects have no vault file, so the marking step CREATED one —
// a two-line phantom carrying `status: closed-won` and nothing else — while the authoritative row
// stayed `lead`. The pre-flight probe recorded the whole family of failures (P1–P7): a promotion
// that reported success and changed nothing anybody reads; a retry with a different client slug that
// produced a SECOND client; and a transient read failure that overwrote a real prospect with a stub.
//
// Four rules now hold, and each is tested by a probe that must turn red without it:
//
//   1. THE STORE IS CHOSEN HERE, ONCE. Postgres mode never touches the hit list; vault mode never
//      touches Postgres. `assertVaultProspectWritable()` makes the wrong-store write impossible
//      rather than merely absent.
//   2. IDENTITY IS THE ANCHOR. The route's reference resolves to exactly one row
//      (`resolveProspectForMutation`); zero or several is a refusal, never a first match. What is
//      written down — on the client, in the event — is `prospect_id`.
//   3. ONE PROSPECT, ONE CLIENT. The client is found by anchor before it is created, so a retry
//      with any client slug converges on the same client instead of making another.
//   4. NO BARE `catch {}`. Every step's result is carried in the outcome. A partial promotion says
//      so; it never returns `ok: true`.
//
// A RESTORE NEVER EMITS AN EVENT; a promotion always does — but only for what actually happened.

import "server-only";
import path from "node:path";
import { hitListDir } from "@/core/vault/paths";
import { readMarkdownFileStrict, writeMarkdownFileAtomic } from "@/core/vault/markdown";
import { emitEvent, readEvents as readVaultEvents } from "@/core/events";
import { uuidv7 } from "@/domain";
import { markProspectPromoted, resolveProspectForMutation, findByProspectId } from "@/core/db";
import { prospectFromMarkdown, prospectFromRow, type Prospect } from "./prospect";
import { assertVaultProspectWritable, resolveProspectSource, withProspectDb, type ProspectSource } from "./source";
import { createClient, findClientPromotedFrom, type ClientFileInput, type Frontmatter } from "./client";

export type PromoteOptions = {
  clientSlug?: string;
  packageTier?: string;
  revenueUsd?: number;
  launchTarget?: string;
};

/**
 * WHAT ACTUALLY HAPPENED, PER EFFECT — never a boolean (D1a).
 *
 * Promotion crosses two stores by construction: clients are vault-owned, prospects are Postgres-owned
 * in the deployed configuration. So there is no single commit, and a result that claimed one would be
 * lying in exactly the cases that matter. Each effect reports its own state, and `outcome` is the
 * honest summary of the pair.
 */
export type PromotionOutcome = {
  /**
   * `promoted`         the client exists and the prospect was marked in this call
   * `already_promoted` both were already true — a safe, idempotent repeat
   * `incomplete`       one effect landed and the other did not; `retry` says what to do
   * `refused`          nothing was written anywhere
   */
  outcome: "promoted" | "already_promoted" | "incomplete" | "refused";
  client: {
    slug: string | null;
    clientId: string | null;
    state: "created" | "existing" | "failed" | "not_attempted";
    reason?: string;
  };
  prospect: {
    state: "marked" | "already_marked" | "not_marked" | "refused";
    reason?: string;
  };
  operation: {
    /** The anchor this promotion is keyed on. Null only when nothing resolved. */
    prospectId: string | null;
    correlationId: string;
    store: ProspectSource;
  };
  /**
   * `safe`       retrying converges: it reuses the client and only finishes what is missing
   * `not_needed` everything is done
   * `refused`    retrying will fail the same way until something else changes
   */
  retry: "safe" | "not_needed" | "refused";
  refusal?: { code: RefusalCode; message: string };
};

export type RefusalCode =
  | "prospect_not_found"
  | "ambiguous_prospect"
  | "held_prospect"
  | "client_exists"
  | "duplicate_client_id"
  /** The vault file exists but could not be read. Nothing is written — least of all over it. */
  | "prospect_unreadable";

const dateOnly = (iso: string) => iso.slice(0, 10);

const refused = (
  code: RefusalCode, message: string, correlationId: string, store: ProspectSource, prospectId: string | null = null
): PromotionOutcome => ({
  outcome: "refused",
  client: { slug: null, clientId: null, state: "not_attempted" },
  prospect: { state: "not_marked", reason: message },
  operation: { prospectId, correlationId, store },
  retry: "refused",
  refusal: { code, message },
});

// ─── the client's four files ───────────────────────────────────────────────────────────────────

function clientFiles(prospect: Prospect, newClientSlug: string, now: string, opts: PromoteOptions) {
  const fm = prospect.frontmatter;
  // CERTAINTY DEFAULT — REMOVED (unchanged from the previous implementation). This was `?? "growth"`,
  // which turned "the caller did not say" into a stored assertion that the client bought Growth, and
  // from there into contracted revenue via TIER_PRICES. "" is the vault's existing representation of
  // an unstated tier; `normalizeTier("")` returns null, so revenue resolves to null. Absence stays
  // absence. (The PromoteButton's own "growth" default is separate, recorded debt — D1 §10.)
  const packageTier = opts.packageTier ?? "";
  const launchTarget = opts.launchTarget ?? "";

  const business: ClientFileInput = {
    frontmatter: {
      name: fm.name ?? newClientSlug,
      business: fm.name ?? newClientSlug,
      industry: fm.business_type ?? "",
      location: fm.location ?? "",
      contact_name: fm.contact_name ?? "",
      contact_email: fm.contact_email ?? "",
      contact_phone: fm.contact_phone ?? "",
      website: fm.website ?? "",
      languages: ["English"],
      retainer_active: false,
    },
    body: [
      "## Overview",
      prospect.body
        ? "Carried over from prospect notes:\n\n" + prospect.body
        : "_(fill in once kickoff is complete)_",
      "",
      "## Goals",
      "- _(capture during kickoff call)_",
      "",
      "## Notes",
      `- Promoted from Hit List on ${dateOnly(now)} (prospect score was ${prospect.score.score}/100).`,
    ].join("\n"),
  };

  const brand: ClientFileInput = {
    frontmatter: {
      primary_color: "", secondary_color: "", accent_color: "",
      fonts: { heading: "", body: "" },
      voice: "", logo_assets: [], photography_style: "",
    },
    body: [
      "## Brand Voice",
      "_(capture from kickoff / onboarding portal submission)_",
      "",
      "## Visual Notes",
      "_(any references the client shared during sales)_",
    ].join("\n"),
  };

  const scopeFrontmatter: Frontmatter = {
    phase: "onboarding", package: packageTier, deliverables: [],
    launch_target: launchTarget, status: "active",
  };
  if (opts.revenueUsd !== undefined) scopeFrontmatter.revenue_usd = opts.revenueUsd;

  const scope: ClientFileInput = {
    frontmatter: scopeFrontmatter,
    body: [
      "## Scope Summary",
      "_(populate after kickoff — what we're building and why)_",
      "",
      "## Out of Scope",
      "_(be explicit — protects against scope creep)_",
      "",
      "## Decisions Log",
      `- ${dateOnly(now)} — promoted from Hit List prospect.`,
    ].join("\n"),
  };

  return { business, brand, scope, packageTier };
}

/**
 * Find the client this prospect was already promoted to, or create it.
 *
 * THE ANCHOR IS THE KEY, not the client slug the operator typed. That is what makes a retry with a
 * different `client_slug` converge instead of producing a second client (probe M2).
 *
 * `promoted_from_prospect` keeps carrying the slug for the existing graph edge; `promoted_from_prospect_id`
 * is the new durable one. Both are written, neither is inferred from the other.
 */
async function findOrCreateClient(
  prospect: Prospect, anchor: string | null, reference: string, opts: PromoteOptions, correlationId: string, now: string
): Promise<
  | { ok: true; slug: string; clientId: string; state: "created" | "existing" }
  | { ok: false; code: "client_exists" | "duplicate_client_id"; message: string }
> {
  if (anchor) {
    const existing = await findClientPromotedFrom(anchor);
    if (existing) {
      // REPAIR, NOT RE-EMIT. A client folder that exists with no `client.created` is the one state
      // where a retry legitimately emits: the files landed and the event did not. Checked against
      // the log rather than assumed, so a normal retry emits nothing.
      const seen = await readVaultEvents({ types: ["client.created"], entity: "client", entity_id: existing.clientId });
      if (seen.length === 0) {
        await emitEvent({
          type: "client.created",
          subject: { entity: "client", entity_id: existing.clientId },
          data: { slug: existing.slug, name: prospect.frontmatter.name ?? existing.slug, source: "hit-list-promotion" },
          correlation_id: correlationId,
        });
      }
      return { ok: true, slug: existing.slug, clientId: existing.clientId, state: "existing" };
    }
  }

  const newClientSlug = (opts.clientSlug ?? reference).trim();
  const { business, brand, scope, packageTier } = clientFiles(prospect, newClientSlug, now, opts);
  const meta: Frontmatter = {
    client_id: newClientSlug,
    organization_id: "ascend",
    status: "active",
    tier: packageTier,
    created_at: now,
    promoted_from_prospect: reference,
    ...(anchor ? { promoted_from_prospect_id: anchor } : {}),
    source: "hit-list-promotion",
  };
  const created = await createClient({ slug: newClientSlug, business, brand, scope, meta }, { correlationId });
  if (!created.ok) return created;
  return { ok: true, slug: created.slug, clientId: created.clientId, state: "created" };
}

// ─── the two stores ────────────────────────────────────────────────────────────────────────────

/**
 * Postgres mode: the row is authoritative, and the hit list is never touched.
 *
 * The status change and `prospect.promoted` commit in ONE transaction (`markProspectPromoted` runs
 * inside the connection `withProspectDb` binds), so there is no state where the prospect is won with
 * no memory of why.
 */
async function promoteInPostgres(reference: string, opts: PromoteOptions, correlationId: string): Promise<PromotionOutcome> {
  const now = new Date().toISOString();
  const store: ProspectSource = "postgres";

  // 1 · IDENTITY, before anything is written.
  const resolved = await withProspectDb(async (tx) => {
    const r = await resolveProspectForMutation(tx, reference);
    if (!r.ok) return { r } as const;
    const row = await findByProspectId(tx, r.target.prospectId);
    return { r, row } as const;
  }, "promote");

  if (!resolved.r.ok) {
    const { reason, matches } = resolved.r;
    if (reason === "not_found") {
      return refused("prospect_not_found", `no prospect answers to "${reference}"`, correlationId, store);
    }
    if (reason === "ambiguous") {
      return refused("ambiguous_prospect",
        `"${reference}" names ${matches} prospects; promotion needs exactly one. Nothing was written.`,
        correlationId, store);
    }
    return refused("held_prospect",
      `"${reference}" is a HELD prospect: it has no identity anchor, so it cannot be promoted until ` +
      "its identity is resolved. Nothing was written.", correlationId, store);
  }
  const target = resolved.r.target;
  if (!resolved.row) {
    return refused("prospect_not_found", `the prospect resolved but its row could not be read back`, correlationId, store, target.prospectId);
  }
  const prospect = prospectFromRow(resolved.row);

  // 2 · THE CLIENT (vault), found by anchor or created staged-then-renamed.
  const client = await findOrCreateClient(prospect, target.prospectId, reference, opts, correlationId, now);
  if (!client.ok) {
    return {
      ...refused(client.code, client.message, correlationId, store, target.prospectId),
      client: { slug: null, clientId: null, state: "failed", reason: client.message },
    };
  }

  // 3 · THE MARK (Postgres): compare-and-set + event, one transaction.
  //
  // NOT a bare catch. A failure here is a REAL partial outcome — the client exists — and the caller
  // is told exactly that, with a retry that converges rather than duplicating.
  let mark: Awaited<ReturnType<typeof markProspectPromoted>>;
  try {
    mark = await withProspectDb((tx, principal) =>
      markProspectPromoted(tx, principal.organizationId, {
        target, clientSlug: client.slug, clientId: client.clientId, correlationId,
        actorUserId: principal.userId,
        completedAfterIncomplete: client.state === "existing",
      }), "promote");
  } catch (e) {
    return {
      outcome: "incomplete",
      client: { slug: client.slug, clientId: client.clientId, state: client.state },
      prospect: { state: "not_marked", reason: (e as Error).message },
      operation: { prospectId: target.prospectId, correlationId, store },
      retry: "safe",
    };
  }

  if (mark.state === "refused") {
    return {
      outcome: "incomplete",
      client: { slug: client.slug, clientId: client.clientId, state: client.state },
      prospect: { state: "refused", reason: mark.reason },
      operation: { prospectId: target.prospectId, correlationId, store },
      // A refusal is a permission fact, not a transient one: the same caller retrying changes nothing.
      retry: "refused",
    };
  }
  return {
    outcome: mark.state === "marked" ? "promoted" : "already_promoted",
    client: { slug: client.slug, clientId: client.clientId, state: client.state },
    prospect: { state: mark.state },
    operation: { prospectId: target.prospectId, correlationId, store },
    retry: "not_needed",
  };
}

/**
 * Vault mode: the hit-list file is authoritative.
 *
 * Two changes from the pre-D1a behaviour, both of them about NOT writing:
 *   · an ABSENT file is never created — a promotion does not invent a prospect;
 *   · an UNREADABLE file is never overwritten (`readMarkdownFileStrict`), which is what destroyed a
 *     real prospect's anchor, name and body in probe P6.
 */
async function promoteInVault(slug: string, opts: PromoteOptions, correlationId: string): Promise<PromotionOutcome> {
  const now = new Date().toISOString();
  const store: ProspectSource = "vault";

  // ONE STRICT READ, BEFORE ANYTHING IS WRITTEN. `getProspect` maps every read failure to "not
  // found", which is right for a page and wrong here: the pre-D1a path read that way and then wrote
  // the file back, replacing a real prospect with a stub (P6). Absence and unreadability are
  // different answers, and neither of them writes.
  assertVaultProspectWritable();
  const prospectPath = path.join(hitListDir(), `${slug}.md`);
  let md;
  try {
    md = await readMarkdownFileStrict(prospectPath);
  } catch (e) {
    return refused("prospect_unreadable",
      `the prospect file for ${slug} could not be read (${(e as Error).message}); nothing was written, ` +
      "and the file was NOT rewritten", correlationId, store);
  }
  if (md.missing) return refused("prospect_not_found", `prospect ${slug} not found`, correlationId, store);
  const prospect = prospectFromMarkdown(slug, md);

  const client = await findOrCreateClient(prospect, prospect.id, slug, opts, correlationId, now);
  if (!client.ok) {
    return {
      ...refused(client.code, client.message, correlationId, store, prospect.id),
      client: { slug: null, clientId: null, state: "failed", reason: client.message },
    };
  }

  const incomplete = (reason: string, retry: "safe" | "refused"): PromotionOutcome => ({
    outcome: "incomplete",
    client: { slug: client.slug, clientId: client.clientId, state: client.state },
    prospect: { state: "not_marked", reason },
    operation: { prospectId: prospect.id, correlationId, store },
    retry,
  });

  if (md.frontmatter.status === "closed-won") {
    return {
      outcome: "already_promoted",
      client: { slug: client.slug, clientId: client.clientId, state: client.state },
      prospect: { state: "already_marked" },
      operation: { prospectId: prospect.id, correlationId, store },
      retry: "not_needed",
    };
  }

  try {
    const nextFm = { ...md.frontmatter, status: "closed-won", last_contact: dateOnly(now) };
    const nextBody = md.body + `\n\n## Promotion\n- ${dateOnly(now)} — promoted to CRM client \`${client.slug}\`.\n`;
    await writeMarkdownFileAtomic(prospectPath, nextFm, nextBody);
    await emitEvent({
      type: "prospect.promoted",
      subject: { entity: "prospect", entity_id: slug },
      data: { client_slug: client.slug, client_id: client.clientId },
      correlation_id: correlationId,
    });
  } catch (e) {
    return incomplete((e as Error).message, "safe");
  }

  return {
    outcome: "promoted",
    client: { slug: client.slug, clientId: client.clientId, state: client.state },
    prospect: { state: "marked" },
    operation: { prospectId: prospect.id, correlationId, store },
    retry: "not_needed",
  };
}

/** Promote a prospect to a client, against whichever store owns prospects. */
export async function promoteProspect(reference: string, opts: PromoteOptions = {}): Promise<PromotionOutcome> {
  const correlationId = uuidv7();
  return resolveProspectSource() === "postgres"
    ? promoteInPostgres(reference, opts, correlationId)
    : promoteInVault(reference, opts, correlationId);
}
