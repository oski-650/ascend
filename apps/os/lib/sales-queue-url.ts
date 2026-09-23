import type { Cursor, DueState, SalesQueueFilter } from "@/core/crm/sales";

export type SearchValues = Record<string, string | string[] | undefined>;
export type BrowseValues = { scope: "mine" | "team"; assignee: string; stage: string; due: string; never: boolean; within: string; name: string; sort: "name" | "due" | "last_contact"; cursor: Cursor | null; invalidCursor: boolean };
const first = (v: string | string[] | undefined) => typeof v === "string" ? v : "";
const stageSet = new Set(["lead", "contacted", "proposal", "closed-won", "closed-lost"]);
const dueSet = new Set(["overdue", "today", "upcoming", "none"]);
const sortSet = new Set(["name", "due", "last_contact"]);
// Bound attacker-supplied encoded input before decoding. The name key itself stays complete:
// prospects.name is database text and has no 256-character business limit.
const MAX_ENCODED_CURSOR = 16_384;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultScope(role: string): "mine" | "team" { return role === "sales" ? "mine" : "team"; }

export function parseBrowseValues(raw: SearchValues, role: string): BrowseValues {
  const scope = first(raw.scope) === "mine" || first(raw.scope) === "team" ? first(raw.scope) as "mine" | "team" : defaultScope(role);
  const requestedAssignee = first(raw.assignee);
  const assignee = requestedAssignee === "unassigned" ? "unassigned" : uuid.test(requestedAssignee) ? requestedAssignee.toLowerCase() : "";
  const stage = stageSet.has(first(raw.stage)) ? first(raw.stage) : "";
  const due = dueSet.has(first(raw.due)) ? first(raw.due) : "";
  const withinRaw = first(raw.within);
  const within = /^(7|14|30|90)$/.test(withinRaw) ? withinRaw : "";
  const name = first(raw.name).trim().slice(0, 80);
  const sort = sortSet.has(first(raw.sort)) ? first(raw.sort) as BrowseValues["sort"] : "name";
  const base = { scope, assignee, stage, due, never: first(raw.never) === "1", within, name, sort };
  let cursor: Cursor | null = null;
  let invalidCursor = false;
  const encoded = first(raw.cursor);
  if (encoded) {
    try {
      if (encoded.length > MAX_ENCODED_CURSOR || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("cursor form");
      const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { v?: number; q?: typeof base; after?: Cursor };
      const key = decoded.after?.key;
      if (decoded.v !== 1 || JSON.stringify(decoded.q) !== JSON.stringify(base) || !decoded.after ||
          !uuid.test(decoded.after.id) || typeof key !== "string" ||
          (sort === "due" && !/^(1|0\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6})$/.test(key)) ||
          (sort === "last_contact" && !/^(1|0\d{9})$/.test(key)) ||
          (sort === "name" && /[\u0000-\u001f\u007f]/.test(key))) throw new Error("cursor state");
      cursor = decoded.after;
    } catch { invalidCursor = true; }
  }
  return { ...base, cursor, invalidCursor };
}

export function browseFilter(v: BrowseValues): SalesQueueFilter {
  return {
    ...(v.assignee === "unassigned" ? { unassignedOnly: true } : v.assignee ? { assignee: v.assignee } : {}),
    ...(v.stage ? { stage: v.stage as SalesQueueFilter["stage"] } : {}),
    ...(v.due ? { dueState: v.due as DueState } : {}),
    ...(v.never ? { neverContacted: true } : {}),
    ...(v.within ? { contactedWithinDays: Number(v.within) } : {}),
    ...(v.name ? { search: v.name } : {}),
    sort: v.sort, after: v.cursor ?? undefined, limit: 50,
  };
}

export function browseHref(v: Omit<BrowseValues, "cursor" | "invalidCursor">, cursor?: Cursor | null): string {
  const q = new URLSearchParams();
  q.set("scope", v.scope);
  if (v.assignee) q.set("assignee", v.assignee);
  if (v.stage) q.set("stage", v.stage);
  if (v.due) q.set("due", v.due);
  if (v.never) q.set("never", "1");
  if (v.within) q.set("within", v.within);
  if (v.name) q.set("name", v.name);
  if (v.sort !== "name") q.set("sort", v.sort);
  if (cursor) q.set("cursor", Buffer.from(JSON.stringify({ v: 1, q: v, after: cursor })).toString("base64url"));
  return `/sales/list?${q.toString()}`;
}
