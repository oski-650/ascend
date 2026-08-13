import { eventLogDomainFor, type EventEnvelope, type EventType } from "@/domain";

/**
 * Activity Stream — pure presentation of the event spine (Phase 3.2).
 *
 * UI-TRANSLATION ONLY. This component MAY: translate event types into readable labels,
 * format timestamps, and display existing event fields. It MAY NOT: infer business meaning,
 * create derived insights, classify events as success/risk/opportunity, or recommend anything.
 * Any interpretation layer belongs to engines/signals — never to this projection.
 *
 * The leading dot is colored by the event's STRUCTURAL log-domain (the canonical
 * `eventLogDomainFor` taxonomy) purely to aid scanning — it is categorization, not a
 * business judgment. No color here means "good" or "bad".
 */
export function ActivityStream({ events }: { events: EventEnvelope[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-6 text-sm text-zinc-500">
        No activity recorded yet. Events will appear here as you work.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {events.map((e, i) => {
        const detail = detailFor(e);
        return (
          <li key={e.event_id} className={i > 0 ? "border-t border-zinc-800/40" : ""}>
            <div className="flex items-start gap-3 py-2.5">
              <span
                className={`mt-[7px] size-1.5 shrink-0 rounded-full ${dotClass(e.type)}`}
                title={domainLabel(e.type)}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-zinc-300">
                  <span className="font-medium text-zinc-100">{phraseFor(e.type)}</span>
                  {detail && <span className="text-zinc-500"> · {detail}</span>}
                </p>
                {e.actor !== "operator" && (
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">{e.actor}</p>
                )}
              </div>
              <time
                dateTime={e.occurred_at}
                title={safeDate(e.occurred_at)?.toLocaleString() ?? e.occurred_at}
                className="mt-px shrink-0 font-mono text-[10px] uppercase tracking-widest tabular-nums text-zinc-500"
              >
                {relativeTime(e.occurred_at)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── UI translation: event type → readable label ───────────────────────────────

const PHRASES: Partial<Record<EventType, string>> = {
  "client.created": "New client",
  "prospect.promoted": "Prospect promoted",
  "project.created": "Project created",
  "project.checklist_toggled": "Checklist updated",
  "invoice.created": "Invoice created",
  "invoice.paid": "Invoice paid",
  "invoice.unpaid": "Invoice marked unpaid",
  "time.started": "Timer started",
  "time.stopped": "Timer stopped",
  "time.logged": "Time logged",
};

function phraseFor(type: EventType): string {
  return PHRASES[type] ?? humanizeType(type);
}

/** Fallback translation for any unmapped type: "invoice.paid" → "Invoice paid". */
function humanizeType(type: string): string {
  const s = type.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Detail line: display existing event fields (no derivation) ─────────────────

function detailFor(e: EventEnvelope): string {
  const d = e.data ?? {};
  const parts: string[] = [];

  const who = subjectLabel(e);
  if (who) parts.push(who);

  switch (e.type) {
    case "invoice.created":
    case "invoice.paid":
    case "invoice.unpaid": {
      const amount = num(d.amount_usd);
      if (amount !== null) parts.push(formatUsd(amount));
      const label = str(d.label);
      if (label) parts.push(label);
      break;
    }
    case "time.started":
    case "time.stopped":
    case "time.logged": {
      const seconds = num(d.duration_seconds);
      if (seconds !== null) parts.push(formatDuration(seconds));
      const phase = str(d.phase);
      if (phase) parts.push(phase);
      const task = str(d.task);
      if (task) parts.push(task);
      break;
    }
    case "project.created": {
      const template = str(d.template);
      if (template) parts.push(template);
      break;
    }
    case "project.checklist_toggled": {
      const phase = str(d.phase);
      if (phase) parts.push(phase);
      if (typeof d.done === "boolean") parts.push(d.done ? "checked" : "unchecked");
      break;
    }
    default:
      break;
  }

  return parts.join(" · ");
}

/** The most human "who" available in the envelope, envelope-only (D-3.2.1 Option A). */
function subjectLabel(e: EventEnvelope): string | null {
  const d = e.data ?? {};
  const name = str(d.name);
  if (name) return name; // already friendly (e.g. client.created)
  const slug = str(d.client) ?? str(d.client_slug);
  if (slug) return humanizeSlug(slug);
  const id = e.subject?.entity_id;
  if (id && !looksLikeUuid(id)) return humanizeSlug(id); // slug-keyed subject (client/project/prospect)
  return null;
}

// ─── Structural domain → dot color (categorization, not judgment) ──────────────

const DOMAIN_DOT: Record<string, string> = {
  crm: "bg-violet-400",
  production: "bg-sky-400",
  finance: "bg-amber-400",
  documents: "bg-slate-400",
  portal: "bg-teal-400",
  automation: "bg-fuchsia-400",
  intelligence: "bg-indigo-400",
  notifications: "bg-rose-400",
  unknown: "bg-zinc-600",
};

function domainLabel(type: EventType): string {
  try {
    return eventLogDomainFor(type);
  } catch {
    return "unknown";
  }
}

function dotClass(type: EventType): string {
  return DOMAIN_DOT[domainLabel(type)] ?? DOMAIN_DOT.unknown;
}

// ─── Formatting helpers (pure presentation) ────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function humanizeSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function formatUsd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${total}s`;
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(iso: string): string {
  const then = safeDate(iso);
  if (!then) return "—";
  const diffMs = Date.now() - then.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
