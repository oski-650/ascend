import "server-only";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { appDataDir, auditsLogPath } from "./paths";

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

async function readAll(): Promise<Audit[]> {
  await ensureFile();
  const raw = await fs.readFile(auditsLogPath(), "utf8");
  if (!raw.trim()) return [];
  const out: Audit[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as Audit);
    } catch {
      /* skip */
    }
  }
  return out;
}

export async function listAudits(client?: string): Promise<Audit[]> {
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
  await ensureFile();
  const entry: Audit = { id: randomUUID(), ...audit };
  await fs.appendFile(auditsLogPath(), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export async function latestAudit(client: string, strategy: AuditStrategy): Promise<Audit | null> {
  const all = await listAudits(client);
  return all.find((a) => a.strategy === strategy) ?? null;
}

export async function historyFor(
  client: string,
  strategy: AuditStrategy,
  limit = 12
): Promise<Audit[]> {
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
