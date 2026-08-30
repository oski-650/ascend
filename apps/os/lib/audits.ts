import "server-only";
import { emitEvent } from "@/core/events";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { appDataDir, auditsLogPath } from "./paths";
import { requireCapability } from "@/core/auth/authority";

export type AuditStrategy = "mobile" | "desktop";

export type LighthouseScores = {
  performance: number | null;       // 0-100
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
};

export type CoreWebVitals = {
  lcp_ms: number | null;            // Largest Contentful Paint
  fcp_ms: number | null;            // First Contentful Paint
  cls: number | null;               // Cumulative Layout Shift
  ttfb_ms: number | null;           // Time to First Byte
  inp_ms: number | null;            // Interaction to Next Paint
};

export type AuditOpportunity = {
  id: string;
  title: string;
  savings_ms: number | null;
};

export type Audit = {
  id: string;
  client: string;
  url: string;
  strategy: AuditStrategy;
  run_at: string;                   // ISO
  scores: LighthouseScores;
  cwv: CoreWebVitals;
  opportunities: AuditOpportunity[];
  source: "psi" | "seed" | "manual";
  note?: string;
};

async function ensureFile(): Promise<void> {
  await fs.mkdir(appDataDir(), { recursive: true });
  try {
    await fs.access(auditsLogPath());
  } catch {
    await fs.writeFile(auditsLogPath(), "", "utf8");
  }
}

/**
 * Coerce a parsed JSONL record into a structurally complete Audit.
 *
 * Records are cast to `Audit` with no runtime validation, so a hand-edited or partially-written line
 * can be missing whole sub-objects. `scores` in particular is dereferenced unguarded in ~15 places
 * (maintenance page, AuditClientCard, the maintenance brief, deltaSinceLast) — a record without it
 * threw `Cannot read properties of undefined (reading 'performance')` and took those surfaces down.
 *
 * Normalising HERE rather than at each call site means one guarantee serves every consumer, and it
 * matches the reader posture used elsewhere: absent data becomes an explicit null, never a fabricated
 * number. `LighthouseScores` and `CoreWebVitals` already model every metric as `number | null`, so
 * this only makes the declared type actually hold. The engine (site-quality) was already defensive
 * here; the surfaces were not.
 */
function normalizeAudit(record: Partial<Audit>): Audit {
  const s = (record.scores ?? {}) as Partial<LighthouseScores>;
  const c = (record.cwv ?? {}) as Partial<CoreWebVitals>;
  return {
    ...(record as Audit),
    scores: {
      performance: s.performance ?? null,
      accessibility: s.accessibility ?? null,
      best_practices: s.best_practices ?? null,
      seo: s.seo ?? null,
    },
    cwv: {
      lcp_ms: c.lcp_ms ?? null,
      fcp_ms: c.fcp_ms ?? null,
      cls: c.cls ?? null,
      ttfb_ms: c.ttfb_ms ?? null,
      inp_ms: c.inp_ms ?? null,
    },
    opportunities: Array.isArray(record.opportunities) ? record.opportunities : [],
  };
}

async function readAll(): Promise<Audit[]> {
  await ensureFile();
  const raw = await fs.readFile(auditsLogPath(), "utf8");
  if (!raw.trim()) return [];
  const out: Audit[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(normalizeAudit(JSON.parse(t) as Partial<Audit>));
    } catch {
      /* skip malformed — reconciled, not fatal */
    }
  }
  return out;
}

export async function listAudits(client?: string): Promise<Audit[]> {
  await requireCapability("audits:*");
  const all = await readAll();
  const filtered = client ? all.filter((a) => a.client === client) : all;
  // JSONL records are cast to Audit at parse time with no runtime validation, so `run_at` may be
  // absent or null on a hand-edited or partially-flushed line. Reading `.localeCompare` off that
  // threw a TypeError from inside the reader — intermittently, since whether it throws depends on
  // where V8's sort places the bad record. That crash propagated through assembleSiteQuality to the
  // dashboard, which has no boundary, taking down every other section with it.
  // Coercing to "" sorts undated records last without inventing a date for them.
  return filtered.sort((a, b) => (b.run_at ?? "").localeCompare(a.run_at ?? ""));
}

export async function appendAudit(audit: Omit<Audit, "id">): Promise<Audit> {
  await requireCapability("audits:*");
  await ensureFile();
  const entry: Audit = { id: randomUUID(), ...audit };
  await fs.appendFile(auditsLogPath(), JSON.stringify(entry) + "\n", "utf8");
  // An audit record is append-only and every append is a new observation, so there is no no-op
  // case here: one committed append ⇒ exactly one event.
  await emitEvent({
    type: "audit.recorded",
    subject: { entity: "audit", entity_id: entry.id },
    data: {
      client: entry.client,
      strategy: entry.strategy,
      url: entry.url,
      performance: entry.scores.performance,
      source: entry.source,
    },
  });
  return entry;
}

export async function latestAudit(client: string, strategy: AuditStrategy): Promise<Audit | null> {
  await requireCapability("audits:*");
  const all = await listAudits(client);
  return all.find((a) => a.strategy === strategy) ?? null;
}

export async function historyFor(
  client: string,
  strategy: AuditStrategy,
  limit = 12
): Promise<Audit[]> {
  await requireCapability("audits:*");
  const all = await listAudits(client);
  return all
    .filter((a) => a.strategy === strategy)
    .slice(0, limit)
    .reverse(); // oldest → newest for charts
}

export function deltaSinceLast(history: Audit[], strategy: AuditStrategy): number | null {
  const filtered = history.filter((a) => a.strategy === strategy);
  if (filtered.length < 2) return null;
  const latest = filtered[filtered.length - 1];
  const prior = filtered[filtered.length - 2];
  if (latest.scores.performance === null || prior.scores.performance === null) return null;
  return latest.scores.performance - prior.scores.performance;
}
