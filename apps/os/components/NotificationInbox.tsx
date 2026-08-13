import type { Notification } from "@/engines/notification-engine";

type Action = (formData: FormData) => Promise<void>;

/**
 * Notification inbox — pure presentation of reconcile() output (Phase 3.6a/b).
 *
 * Renders active notifications (raised + viewed) with operator controls, and a muted list of snoozed
 * items. Rendering emits NOTHING (D-3.6.3) — viewed / snoozed / dismissed happen only via the
 * operator-triggered server actions. `viewed` items stay visible but de-emphasized (D-3.6b.2); snoozed
 * items are hidden from the active list until their `until` passes (or their fingerprint changes — the
 * engine's job). Ordering is by the signal's own producer-preserved severity (single family, MC-2).
 */
export function NotificationInbox({
  notifications,
  dismissAction,
  viewAction,
  snoozeAction,
}: {
  notifications: Notification[];
  dismissAction: Action;
  viewAction: Action;
  snoozeAction: Action;
}) {
  const active = notifications
    .filter((n) => n.status === "raised" || n.status === "viewed")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  const snoozed = notifications.filter((n) => n.status === "snoozed");

  if (active.length === 0 && snoozed.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-6 text-sm text-zinc-500">
        Inbox zero. Nothing awaiting your attention — dismissed items reappear only if their signal changes.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {active.length > 0 && (
        <ul className="flex flex-col gap-2">
          {active.map((n) => (
            <li
              key={n.signalKey}
              className={`flex flex-col gap-2 rounded-lg border border-zinc-800/50 bg-zinc-950/40 p-3 sm:flex-row sm:items-start sm:gap-3 ${
                n.status === "viewed" ? "opacity-60" : ""
              }`}
            >
              <span className={`mt-[6px] hidden size-1.5 shrink-0 rounded-full sm:block ${dotClass(n.severity)}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-zinc-200">{n.title}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">
                  {n.subject.name} · {n.kind.replace(/[._]/g, " ")}
                  {n.status === "viewed" ? " · seen" : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {n.status === "raised" && <ActionButton action={viewAction} n={n} label="seen" />}
                <form action={snoozeAction} className="flex items-center gap-1">
                  <input type="hidden" name="signalKey" value={n.signalKey} />
                  <input type="hidden" name="fingerprint" value={n.fingerprint} />
                  {(["1h", "1d", "1w"] as const).map((d) => (
                    <button key={d} type="submit" name="duration" value={d} className={BTN} title={`Snooze ${d}`}>
                      {d}
                    </button>
                  ))}
                </form>
                <ActionButton action={dismissAction} n={n} label="dismiss" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {snoozed.length > 0 && (
        <div className="rounded-lg border border-zinc-800/40 bg-zinc-950/30 p-3">
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-600">snoozed · {snoozed.length}</p>
          <ul className="flex flex-col gap-1">
            {snoozed.map((n) => (
              <li key={n.signalKey} className="flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span className="truncate">{n.title}</span>
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">until {formatUntil(n.snoozeUntil)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const BTN =
  "rounded-md border border-zinc-800/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]";

/** One hidden-field form → one operator action. Emits only on submit — never on render. */
function ActionButton({ action, n, label }: { action: Action; n: Notification; label: string }) {
  return (
    <form action={action}>
      <input type="hidden" name="signalKey" value={n.signalKey} />
      <input type="hidden" name="fingerprint" value={n.fingerprint} />
      <button type="submit" className={BTN}>
        {label}
      </button>
    </form>
  );
}

function formatUntil(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric" });
}

/** Presentation-only severity ordering (single-family, producer-preserved values — not a Decision rank). */
function severityRank(sev?: string): number {
  if (sev === "urgent") return 3;
  if (sev === "suggest") return 2;
  if (sev === "info") return 1;
  return 0;
}

function dotClass(sev?: string): string {
  if (sev === "urgent") return "bg-[var(--color-danger)]";
  if (sev === "suggest") return "bg-amber-400";
  return "bg-zinc-500";
}
