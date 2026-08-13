// core/production/time.ts — TimeEntry CRUD + summaries (moved from lib/timeLog.ts, Phase 2.3).
// I/O now flows through core/vault primitives (readJsonlFile + writeFileAtomic) so no fs is
// touched outside core/vault. Event emission (time.*) is preserved verbatim.

import "server-only";
import { timeLogPath } from "@/core/vault/paths";
import { readJsonlFile } from "@/core/vault/io";
import { writeFileAtomic } from "@/core/vault/markdown";
import { emitEvent } from "@/core/events";
import { TIME_ACTIVITIES, isTimeActivity, newTimeEntryId, type TimeActivity, type TimeEntry } from "@/domain";

export type { TimeEntry };

/** D4: time is tracked against the controlled TimeActivity vocabulary — reject drift on write. */
function parseActivity(phase: string): TimeActivity {
  if (!isTimeActivity(phase)) {
    throw new Error(`phase must be one of: ${TIME_ACTIVITIES.join(", ")}`);
  }
  return phase;
}

async function readEntries(): Promise<TimeEntry[]> {
  return readJsonlFile<TimeEntry>(timeLogPath());
}

async function writeEntries(entries: TimeEntry[]): Promise<void> {
  const body = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : "");
  await writeFileAtomic(timeLogPath(), body);
}

export async function getAllEntries(): Promise<TimeEntry[]> {
  return readEntries();
}

export async function getActiveEntry(): Promise<TimeEntry | null> {
  const entries = await readEntries();
  return entries.find((e) => e.ended === null) ?? null;
}

export async function startEntry(args: {
  client: string;
  phase: string;
  task: string;
  note?: string;
}): Promise<TimeEntry> {
  const activity = parseActivity(args.phase);
  const entries = await readEntries();
  const now = new Date();
  const active = entries.find((e) => e.ended === null);
  if (active) {
    active.ended = now.toISOString();
    const started = new Date(active.started).getTime();
    active.duration_seconds = Math.max(0, Math.round((now.getTime() - started) / 1000));
  }
  const entry: TimeEntry = {
    id: newTimeEntryId(),
    client: args.client,
    phase: activity,
    task: args.task,
    started: now.toISOString(),
    ended: null,
    duration_seconds: null,
    note: args.note ?? "",
  };
  entries.push(entry);
  await writeEntries(entries);
  if (active) {
    await emitEvent({
      type: "time.stopped",
      subject: { entity: "time_entry", entity_id: active.id },
      data: { client: active.client, phase: active.phase, task: active.task, duration_seconds: active.duration_seconds },
    });
  }
  await emitEvent({
    type: "time.started",
    subject: { entity: "time_entry", entity_id: entry.id },
    data: { client: entry.client, phase: entry.phase, task: entry.task },
  });
  return entry;
}

export async function logEntry(args: {
  client: string;
  phase: string;
  task: string;
  started: Date;
  durationSeconds: number;
  note?: string;
}): Promise<TimeEntry> {
  const activity = parseActivity(args.phase);
  const entries = await readEntries();
  const ended = new Date(args.started.getTime() + args.durationSeconds * 1000);
  const entry: TimeEntry = {
    id: newTimeEntryId(),
    client: args.client,
    phase: activity,
    task: args.task,
    started: args.started.toISOString(),
    ended: ended.toISOString(),
    duration_seconds: args.durationSeconds,
    note: args.note ?? "",
  };
  entries.push(entry);
  await writeEntries(entries);
  await emitEvent({
    type: "time.logged",
    subject: { entity: "time_entry", entity_id: entry.id },
    data: { client: entry.client, phase: entry.phase, task: entry.task, duration_seconds: entry.duration_seconds },
    occurred_at: entry.ended ?? undefined,
  });
  return entry;
}

export async function stopEntry(id: string, note?: string): Promise<TimeEntry | null> {
  const entries = await readEntries();
  const entry = entries.find((e) => e.id === id);
  if (!entry) return null;
  if (entry.ended !== null) return entry; // already stopped — idempotent
  const now = new Date();
  entry.ended = now.toISOString();
  entry.duration_seconds = Math.max(0, Math.round((now.getTime() - new Date(entry.started).getTime()) / 1000));
  if (note !== undefined) entry.note = note;
  await writeEntries(entries);
  await emitEvent({
    type: "time.stopped",
    subject: { entity: "time_entry", entity_id: entry.id },
    data: { client: entry.client, phase: entry.phase, task: entry.task, duration_seconds: entry.duration_seconds },
  });
  return entry;
}

export async function stopActive(note?: string): Promise<TimeEntry | null> {
  const active = await getActiveEntry();
  if (!active) return null;
  return stopEntry(active.id, note);
}

export type ClientSummary = {
  client: string;
  total_seconds: number;
  entry_count: number;
  byPhase: Record<string, { seconds: number; count: number }>;
  lastEntryAt: string | null;
};

export async function summarizeByClient(): Promise<Record<string, ClientSummary>> {
  const entries = await readEntries();
  const out: Record<string, ClientSummary> = {};
  for (const e of entries) {
    if (e.duration_seconds === null) continue;
    const c = (out[e.client] ??= { client: e.client, total_seconds: 0, entry_count: 0, byPhase: {}, lastEntryAt: null });
    c.total_seconds += e.duration_seconds;
    c.entry_count += 1;
    const ph = (c.byPhase[e.phase] ??= { seconds: 0, count: 0 });
    ph.seconds += e.duration_seconds;
    ph.count += 1;
    if (!c.lastEntryAt || (e.ended && e.ended > c.lastEntryAt)) c.lastEntryAt = e.ended;
  }
  return out;
}

export async function summaryFor(client: string): Promise<ClientSummary | null> {
  const all = await summarizeByClient();
  return all[client] ?? null;
}

export async function secondsInWindow(days: number, client?: string): Promise<number> {
  const entries = await readEntries();
  const cutoff = Date.now() - days * 86400 * 1000;
  let total = 0;
  for (const e of entries) {
    if (e.duration_seconds === null || !e.ended) continue;
    if (client && e.client !== client) continue;
    if (new Date(e.ended).getTime() >= cutoff) total += e.duration_seconds;
  }
  return total;
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function dailyActivityWindow(days: number): Promise<{ date: string; seconds: number; entryCount: number }[]> {
  const entries = await readEntries();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const buckets = new Map<string, { seconds: number; entryCount: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    buckets.set(localDateKey(d), { seconds: 0, entryCount: 0 });
  }
  for (const e of entries) {
    if (e.duration_seconds === null || !e.ended) continue;
    const key = localDateKey(new Date(e.ended));
    const b = buckets.get(key);
    if (b) {
      b.seconds += e.duration_seconds;
      b.entryCount += 1;
    }
  }
  return Array.from(buckets, ([date, v]) => ({ date, seconds: v.seconds, entryCount: v.entryCount }));
}

export async function currentStreak(): Promise<number> {
  const days = await dailyActivityWindow(60);
  let streak = 0;
  const reversed = [...days].reverse();
  const todayBucket = reversed[0];
  const startIdx = todayBucket.entryCount > 0 ? 0 : 1;
  for (let i = startIdx; i < reversed.length; i++) {
    if (reversed[i].entryCount > 0) streak++;
    else break;
  }
  return streak;
}

export function formatDuration(totalSeconds: number, mode: "compact" | "full" = "compact"): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (mode === "full") {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export const APP_DATA_DIRNAME = ".ascend-os";
