// substrate-migration/plan — the deterministic manifest.
//
// DRY RUN BY CONSTRUCTION: no write primitive, and nothing imported that has one.
//
// FULLY DETERMINISTIC, with nothing to inject. Unlike the Stage 1 backfill, this migration MINTS
// NOTHING: every `prospect_id` is carried from the vault, every `event_id` is carried from the
// spine, and the two held records receive no identity at all. Same vault in, byte-identical
// manifest out — there is no clock and no randomness anywhere in it.
//
// WHAT IT REFUSES TO CARRY. No client, project, invoice or document RECORD, per the Stage 2B gate.
// Events ABOUT those entities do travel, because the spine is migrated whole and its subjects are
// (entity, entity_id) strings with no foreign key — splitting the log would break the very ordering
// contract Stage 2A preserved.

import "server-only";
import path from "node:path";
import { createHash } from "node:crypto";
import { hitListDir } from "@/core/vault/paths";
import { listMarkdownFiles, readMarkdownFile, readTextFile } from "@/core/vault/markdown";
import { readEvents } from "@/core/events";
import { readProspectIdFrom } from "@/core/vault/identity";
import { declaredHoldFor } from "@/identity-backfill";
import { LEDGER_FIELDS, raw as rawValue, type LedgerEvent } from "./ledger";

export type ProspectPlan = {
  slug: string;
  prospectId: string | null;
  identityState: "anchored" | "held";
  holdReason: string | null;
  fields: Record<string, string | null>;
  /** The markdown body, carried verbatim. Dropping it deletes the operator's own notes. */
  body: string;
  /** sha256 of the source file — proves the row was built from the bytes that were reviewed. */
  sourceSha256: string;
  /** Why this row exists at all. Never "because a file was there" — always which file, and its hash. */
  provenance: string;
};

export type EventPlan = LedgerEvent & {
  organizationScoped: true;
  actorUserId: string | null;
  data: Record<string, unknown> | null;
  correlationId: string | null;
  subjectEntity: string;
  subjectEntityId: string;
};

export type MigrationManifest = {
  version: 1;
  prospects: ProspectPlan[];
  events: EventPlan[];
  summary: {
    prospects: number; anchored: number; held: number;
    events: number; operatorEvents: number; systemEvents: number;
    birthEventsForProspects: number;
  };
};

/**
 * Build the migration plan from the live vault.
 *
 * `operatorUserId` is threaded in rather than looked up: the schema REFUSES an operator event with
 * no `actor_user_id`, and the only truthful value is the one human who used the OS during the
 * period these events cover. That is a fact supplied by review, not inferred here.
 */
export async function planSubstrateMigration(operatorUserId: string): Promise<MigrationManifest> {
  const dir = hitListDir();
  const files = await listMarkdownFiles(dir);

  const prospects: ProspectPlan[] = [];
  for (const file of files.slice().sort()) {
    const slug = file.replace(/\.md$/, "");
    const abs = path.join(dir, file);
    const raw = await readTextFile(abs);
    if (raw === null) continue;
    const md = await readMarkdownFile(abs);
    const prospectId = readProspectIdFrom(md.frontmatter);
    const declaredHold = declaredHoldFor(slug);

    // IDENTITY STATE IS READ, NOT DECIDED. The vault already answered this in Stage 1; re-deriving
    // it here would let a migration silently disagree with the decision a human reviewed.
    const held = prospectId === null;
    prospects.push({
      slug,
      prospectId,
      identityState: held ? "held" : "anchored",
      holdReason: held
        ? (declaredHold?.reason ?? "unanchored in the vault at migration time; identity unresolved")
        : null,
      // RAW, not normalised: `""` and an absent key are different states in the vault and the
      // migration may not collapse them (see ledger.raw).
      fields: Object.fromEntries(LEDGER_FIELDS.map((f) => [f, rawValue(md.frontmatter[f])])),
      body: md.body,
      sourceSha256: createHash("sha256").update(raw).digest("hex"),
      provenance: `vault:02 - Sales & Hit List/${file}`,
    });
  }

  const spine = await readEvents();
  const events: EventPlan[] = spine.map((e) => ({
    eventId: e.event_id,
    type: e.type,
    actor: e.actor,
    // AN OPERATOR EVENT MUST NAME ITS HUMAN (Stage 2A CHECK). Attributing these to Oscar is a
    // RECORDED FACT, not an inference: he was the only principal with access during the period, and
    // the alternative — leaving them unattributed — is rejected by the database rather than merely
    // discouraged. A system event is left unattributed for the same reason, in the other direction.
    actorUserId: e.actor === "operator" ? operatorUserId : null,
    subject: `${e.subject.entity}:${e.subject.entity_id}`,
    subjectEntity: e.subject.entity,
    subjectEntityId: e.subject.entity_id,
    occurredAt: e.occurred_at,
    data: e.data ?? null,
    correlationId: e.correlation_id ?? null,
    organizationScoped: true as const,
  }));

  const prospectSlugs = new Set(prospects.map((p) => p.slug));
  return {
    version: 1,
    prospects,
    events,
    summary: {
      prospects: prospects.length,
      anchored: prospects.filter((p) => p.identityState === "anchored").length,
      held: prospects.filter((p) => p.identityState === "held").length,
      events: events.length,
      operatorEvents: events.filter((e) => e.actor === "operator").length,
      systemEvents: events.filter((e) => e.actor === "system").length,
      // THE HISTORICAL BOUNDARY, counted in the manifest so a reviewer sees it before applying.
      // Expected: ZERO. Ascend never witnessed any of these prospects being created.
      birthEventsForProspects: events.filter(
        (e) => e.type === "prospect.created" && prospectSlugs.has(e.subjectEntityId)
      ).length,
    },
  };
}

export type ValidationIssue = { subject: string; problem: string };

/** Structural gate between the plan and the database. Same posture as migration/validate. */
export function validateManifest(m: MigrationManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  const seenEvents = new Set<string>();

  for (const p of m.prospects) {
    if ((p.identityState === "anchored") !== (p.prospectId !== null)) {
      issues.push({ subject: p.slug, problem: "identity state and anchor disagree" });
    }
    if ((p.identityState === "held") !== (p.holdReason !== null)) {
      issues.push({ subject: p.slug, problem: "a hold must state a reason" });
    }
    if (p.prospectId) {
      if (seenIds.has(p.prospectId)) issues.push({ subject: p.slug, problem: "duplicate prospect_id" });
      seenIds.add(p.prospectId);
    }
    if (!p.provenance.startsWith("vault:")) {
      issues.push({ subject: p.slug, problem: "row has no vault provenance" });
    }
  }

  for (const e of m.events) {
    if (seenEvents.has(e.eventId)) issues.push({ subject: e.eventId, problem: "duplicate event_id" });
    seenEvents.add(e.eventId);
    if (e.actor === "operator" && !e.actorUserId) {
      issues.push({ subject: e.eventId, problem: "operator event names no human" });
    }
    if (e.actor === "system" && e.actorUserId) {
      issues.push({ subject: e.eventId, problem: "system event claims a human" });
    }
  }

  // THE HEADLINE INVARIANT. The migration moves what the spine already holds; it may not add a
  // birth for a prospect whose creation Ascend never witnessed.
  if (m.summary.birthEventsForProspects > 0) {
    issues.push({
      subject: "manifest",
      problem: "proposes a prospect birth event; origin is unknown and must stay unknown",
    });
  }

  return issues;
}

export function renderManifest(m: MigrationManifest): string {
  const lines = [
    "SUBSTRATE MIGRATION · DRY RUN",
    "",
    `  prospects            ${m.summary.prospects}  (${m.summary.anchored} anchored, ${m.summary.held} held)`,
    `  events               ${m.summary.events}  (${m.summary.operatorEvents} operator, ${m.summary.systemEvents} system)`,
    `  prospect births      ${m.summary.birthEventsForProspects}  ← origin unknown, and stays unknown`,
    "",
  ];
  for (const p of m.prospects) {
    lines.push(
      `  ${p.identityState === "held" ? "HELD    " : "ANCHORED"} ${p.slug}`,
      `           prospect_id ${p.prospectId ?? "—"}`,
      `           source      ${p.provenance}  sha256 ${p.sourceSha256.slice(0, 16)}…`
    );
    if (p.holdReason) lines.push(`           HOLD        ${p.holdReason.slice(0, 88)}`);
  }
  return lines.join("\n") + "\n";
}
