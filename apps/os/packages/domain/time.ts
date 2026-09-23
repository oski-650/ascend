// domain/time — WHEN a follow-up is due, resolved without guessing (2A.1b decision D-6; moved here in
// 2A.2a so the server command and the browser's follow-up picker share ONE implementation).
//
// PURE, like the rest of the kernel: no fs, no Next, no database. `Intl` only, so it is safe in a
// client bundle. The server validates whatever a client sends, and the server's answer wins; this
// module exists so the two cannot disagree about what "Tuesday 9 AM PT" means.
//
// A follow-up is due on a BUSINESS DAY in America/Los_Angeles (`due_on`), and optionally at an exact
// instant (`due_at`). The instant is never produced by asking a database to interpret a wall-clock
// time: across the two daylight-saving transitions a local time can name no instant (spring
// forward, 02:00–02:59 does not exist) or two (fall back, 01:00–01:59 happens twice), and
// PostgreSQL would silently pick one. So the client states the instant it means — the local time
// AND the offset — and this module checks that the two agree with Los Angeles at that instant.
//
//   accepted   { local: "2026-11-01T01:30", offset: "-07:00" }   the FIRST 01:30 (PDT)
//   accepted   { local: "2026-11-01T01:30", offset: "-08:00" }   the SECOND 01:30 (PST) — a different instant
//   refused    { local: "2026-03-08T02:30", offset: any }         no such wall-clock time in Los Angeles
//   refused    { local: "2026-07-01T09:00", offset: "-08:00" }    Los Angeles is -07:00 in July
//   refused    a time without an offset                          ambiguous by construction
//
// Only `due_on` and the instant are stored. The offset is not: the instant plus the canonical zone
// reproduce it exactly.

export const BUSINESS_TZ = "America/Los_Angeles";

export type DueAtInput = { local: string; offset: string } | string;
export type DueResolution =
  | { ok: true; dueOn: string; dueAt: string | null }
  | { ok: false; code: "invalid_due_on" | "invalid_due_at" | "offset_required" | "nonexistent_local_time" | "offset_not_los_angeles" | "due_at_not_on_due_on"; detail: string };

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const OFFSET = /^([+-])(\d{2}):(\d{2})$/;
const ISO_WITH_OFFSET = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::00(?:\.0+)?)?([+-]\d{2}:\d{2}|Z)$/;

function realDate(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The Los Angeles wall clock of an instant, as `YYYY-MM-DDTHH:MM` (ICU time-zone data). */
export function losAngelesWallClock(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/** The Los Angeles business date of an instant. */
export function losAngelesDate(instant: Date): string {
  return losAngelesWallClock(instant).slice(0, 10);
}

/** Resolve `dueOn` (+ optional `dueAt`) to what is stored, or refuse with the reason. Pure. */
export function resolveDue(dueOn: string, dueAt?: DueAtInput | null): DueResolution {
  const d = DATE.exec(dueOn ?? "");
  if (!d || !realDate(Number(d[1]), Number(d[2]), Number(d[3]))) {
    return { ok: false, code: "invalid_due_on", detail: "dueOn must be a real calendar date, YYYY-MM-DD" };
  }
  if (dueAt === undefined || dueAt === null) return { ok: true, dueOn, dueAt: null };

  let local: string, offset: string;
  if (typeof dueAt === "string") {
    const iso = ISO_WITH_OFFSET.exec(dueAt);
    if (!iso) {
      return LOCAL.test(dueAt) || /T\d{2}:\d{2}(:\d{2})?$/.test(dueAt)
        ? { ok: false, code: "offset_required", detail: "a due time must carry its UTC offset" }
        : { ok: false, code: "invalid_due_at", detail: "dueAt must be an ISO timestamp with an offset, or { local, offset }" };
    }
    // `Z` is an offset like any other (+00:00) — and never Los Angeles's, so it is refused below.
    [local, offset] = [iso[1], iso[2] === "Z" ? "+00:00" : iso[2]];
  } else {
    if (typeof dueAt.local !== "string" || !LOCAL.test(dueAt.local)) {
      return { ok: false, code: "invalid_due_at", detail: "dueAt.local must be YYYY-MM-DDTHH:MM" };
    }
    if (typeof dueAt.offset !== "string" || dueAt.offset === "") {
      return { ok: false, code: "offset_required", detail: "a due time must carry its UTC offset" };
    }
    [local, offset] = [dueAt.local, dueAt.offset];
  }

  const l = LOCAL.exec(local)!;
  const o = OFFSET.exec(offset);
  if (!o || Number(o[3]) >= 60 || Number(o[2]) > 14) return { ok: false, code: "invalid_due_at", detail: "offset must be ±HH:MM" };
  const [y, mo, da, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(l[i]));
  if (!realDate(y, mo, da) || h > 23 || mi > 59) return { ok: false, code: "invalid_due_at", detail: "not a real local date and time" };

  const sign = o[1] === "-" ? -1 : 1;
  const offsetMinutes = sign * (Number(o[2]) * 60 + Number(o[3]));
  const instant = new Date(Date.UTC(y, mo - 1, da, h, mi) - offsetMinutes * 60_000);
  const rendered = losAngelesWallClock(instant);
  if (rendered !== local) {
    // Either this wall-clock time does not exist in Los Angeles (no offset maps it to itself), or
    // the offset is not Los Angeles's at that instant.
    const exists = [-420, -480].some((m) => losAngelesWallClock(new Date(Date.UTC(y, mo - 1, da, h, mi) - m * 60_000)) === local);
    return exists
      ? { ok: false, code: "offset_not_los_angeles", detail: `${local} in Los Angeles is not at offset ${offset}` }
      : { ok: false, code: "nonexistent_local_time", detail: `${local} does not exist in Los Angeles (daylight-saving gap)` };
  }
  if (local.slice(0, 10) !== dueOn) {
    return { ok: false, code: "due_at_not_on_due_on", detail: `the time is on ${local.slice(0, 10)}, not ${dueOn}` };
  }
  return { ok: true, dueOn, dueAt: instant.toISOString() };
}

// ─── the browser's side: "now" in Los Angeles, and the follow-up presets ───────────────────────

/** The Los Angeles wall clock right now, as `YYYY-MM-DDTHH:MM`. */
export const laNow = (now: Date = new Date()): string => losAngelesWallClock(now);

/**
 * The UTC offset Los Angeles is at for a given LOCAL wall clock, as `±HH:MM` — or null when that
 * wall clock does not exist there (the spring-forward gap), which the caller must not paper over.
 *
 * Both candidate offsets are tried and the one that renders back to the same wall clock wins. In the
 * fall-back hour BOTH render back; the EARLIER instant (PDT) is returned, and a caller offering the
 * choice passes the offset it means explicitly.
 */
export function laOffsetAt(local: string): string | null {
  const m = LOCAL.exec(local);
  if (!m) return null;
  const [y, mo, da, h, mi] = [1, 2, 3, 4, 5].map((i) => Number(m[i]));
  for (const minutes of [-420, -480]) {
    if (losAngelesWallClock(new Date(Date.UTC(y, mo - 1, da, h, mi) - minutes * 60_000)) === local) {
      return `${minutes < 0 ? "-" : "+"}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
    }
  }
  return null;
}

export type FollowUpPreset = "later_today" | "tomorrow" | "in_2_days" | "next_week" | "no_time";

/** `YYYY-MM-DD` plus n days, computed on the calendar rather than on a 24h clock. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * What a preset means, in Los Angeles, as the command's `{ dueOn, dueAt }` input.
 *
 * `later_today` is +3h rounded up to the next :00 or :30 and is UNAVAILABLE (null) once that would
 * land after 21:00 or on the next day — a "later today" that is tomorrow is a lie. The others are
 * 09:00 local. Every timed result carries the offset Los Angeles is actually at, and a preset that
 * lands in the spring-forward gap moves to 03:00 rather than inventing an offset.
 */
export function followUpPreset(kind: FollowUpPreset, now: Date = new Date()):
  { dueOn: string; dueAt?: { local: string; offset: string } } | null {
  const wall = losAngelesWallClock(now);
  const today = wall.slice(0, 10);
  if (kind === "no_time") return { dueOn: today };

  let day = today;
  let time: string;
  if (kind === "later_today") {
    const [h, mi] = wall.slice(11).split(":").map(Number);
    const slot = mi < 30 ? 30 : 60;
    const hour = h + 3 + (slot === 60 ? 1 : 0);
    if (hour > 21) return null;
    time = `${String(hour).padStart(2, "0")}:${slot === 60 ? "00" : "30"}`;
  } else {
    time = "09:00";
    day = kind === "tomorrow" ? addDays(today, 1)
      : kind === "in_2_days" ? addDays(today, 2)
      : addDays(today, ((8 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7) || 7); // next Monday
  }
  let local = `${day}T${time}`;
  let offset = laOffsetAt(local);
  if (offset === null) {                     // the spring-forward gap: the day starts at 03:00
    local = `${day}T03:00`;
    offset = laOffsetAt(local);
  }
  return offset === null ? { dueOn: day } : { dueOn: day, dueAt: { local, offset } };
}
