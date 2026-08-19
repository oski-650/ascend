"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";

export type LogClientOption = {
  slug: string;
  name: string;
  phases: { key: string; label: string; tasks: string[] }[];
};

const PHASE_FALLBACK = [
  { key: "onboarding", label: "Onboarding" },
  { key: "strategy", label: "Strategy" },
  { key: "design", label: "Design" },
  { key: "dev", label: "Dev" },
  { key: "launch", label: "Launch" },
  { key: "general", label: "General / Admin" },
];

const OTHER_TASK = "__OTHER__";

/**
 * Parses duration strings:
 *   "1h 30m" / "1h30m" → 90
 *   "1.5h"             → 90
 *   "90m" / "90"       → 90  (bare number = minutes)
 *   "1:30"             → 90
 *   "0.5h"             → 30
 * Returns minutes, or null if unparseable.
 */
export function parseDurationToMinutes(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  const colon = s.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  const hourMatch = s.match(/(\d+(?:\.\d+)?)\s*h/);
  const minMatch = s.match(/(\d+(?:\.\d+)?)\s*m(?!s)/);
  if (hourMatch || minMatch) {
    const hours = hourMatch ? Number(hourMatch[1]) : 0;
    const mins = minMatch ? Number(minMatch[1]) : 0;
    const total = Math.round(hours * 60 + mins);
    return total > 0 ? total : null;
  }

  const bare = Number(s);
  if (!isNaN(bare) && bare > 0) return Math.round(bare);

  return null;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function LogTimeForm({ clients }: { clients: LogClientOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [clientSlug, setClientSlug] = useState(clients[0]?.slug ?? "");
  const [phase, setPhase] = useState(PHASE_FALLBACK[0].key);
  const [taskSelect, setTaskSelect] = useState<string>(OTHER_TASK);
  const [taskFree, setTaskFree] = useState("");
  const [date, setDate] = useState(todayISO());
  const [durationRaw, setDurationRaw] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  const client = useMemo(() => clients.find((c) => c.slug === clientSlug), [clients, clientSlug]);
  const phasesForClient = useMemo(() => {
    const set = new Map(PHASE_FALLBACK.map((p) => [p.key, p.label]));
    for (const p of client?.phases ?? []) set.set(p.key, p.label);
    return Array.from(set, ([key, label]) => ({ key, label }));
  }, [client]);

  const tasksForPhase = useMemo(() => {
    const ph = client?.phases.find((p) => p.key === phase);
    return ph?.tasks ?? [];
  }, [client, phase]);

  const minutes = parseDurationToMinutes(durationRaw);
  const taskValue = taskSelect === OTHER_TASK ? taskFree.trim() : taskSelect;
  const valid =
    clientSlug.length > 0 &&
    phase.length > 0 &&
    taskValue.length > 0 &&
    date.length > 0 &&
    minutes !== null &&
    minutes > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setFlash(null);
    try {
      // Anchor entry at noon local on the chosen date so it sits clearly inside that day.
      const startedLocal = new Date(`${date}T12:00:00`);
      const res = await fetch("/api/time/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientSlug,
          phase,
          task: taskValue,
          started: startedLocal.toISOString(),
          duration_seconds: (minutes as number) * 60,
          note: note.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { entry?: unknown; error?: string };
      if (!res.ok) {
        setFlash({ kind: "err", msg: json.error ?? "Failed to log entry" });
        return;
      }
      setFlash({ kind: "ok", msg: `Logged ${formatMinutes(minutes as number)} on ${taskValue}` });
      setDurationRaw("");
      setNote("");
      if (taskSelect === OTHER_TASK) setTaskFree("");
      router.refresh();
    } catch (err) {
      setFlash({ kind: "err", msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    // Migrated off the rounded card: on the Tasks surface it was the only boxed element on an
    // otherwise hairline page, which made an optional manual-entry form read as the main event.
    // It is now a plain disclosure that opens into a hairline-bounded form.
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="border-b border-[var(--color-line)]"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 py-3 [&::-webkit-details-marker]:hidden">
        <span className="t-body flex items-center gap-2 text-[var(--color-t2)] transition-colors duration-[120ms] hover:text-[var(--color-t1)]">
          <span aria-hidden className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span>Log time after the fact</span>
        </span>
        <span className="t-label text-[var(--color-t3)]">manual entry</span>
      </summary>

      <form onSubmit={submit} className="grid grid-cols-1 gap-3 border-t border-[var(--color-line)] py-4 sm:grid-cols-2">
        <Field label="Client">
          <select
            value={clientSlug}
            onChange={(e) => {
              setClientSlug(e.target.value);
              setTaskSelect(OTHER_TASK);
            }}
            className={selectClass}
          >
            {clients.length === 0 && <option value="">(no clients with production states)</option>}
            {clients.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Phase">
          <select
            value={phase}
            onChange={(e) => {
              setPhase(e.target.value);
              setTaskSelect(OTHER_TASK);
            }}
            className={selectClass}
          >
            {phasesForClient.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Task" className="sm:col-span-2">
          <select value={taskSelect} onChange={(e) => setTaskSelect(e.target.value)} className={selectClass}>
            {tasksForPhase.length > 0 && (
              <optgroup label={`From production_state.md (${tasksForPhase.length})`}>
                {tasksForPhase.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={OTHER_TASK}>— other / custom (type below) —</option>
          </select>
          {taskSelect === OTHER_TASK && (
            <input
              type="text"
              value={taskFree}
              onChange={(e) => setTaskFree(e.target.value)}
              placeholder="e.g. Discovery call follow-up"
              className={inputClass + " mt-2"}
            />
          )}
        </Field>

        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>

        <Field
          label="Duration"
          hint={
            durationRaw && minutes === null
              ? "couldn't parse"
              : minutes !== null
                ? `= ${formatMinutes(minutes)}`
                : "1h 30m · 90m · 1:30 · 1.5h"
          }
          hintBad={!!durationRaw && minutes === null}
        >
          <input
            type="text"
            value={durationRaw}
            onChange={(e) => setDurationRaw(e.target.value)}
            placeholder="1h 30m"
            inputMode="text"
            className={inputClass}
          />
        </Field>

        <Field label="Note (optional)" className="sm:col-span-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything worth remembering about this block"
            className={inputClass}
          />
        </Field>

        <div className="flex items-center justify-between gap-3 sm:col-span-2">
          <div className="min-h-[20px] text-xs">
            {flash && (
              <span className={flash.kind === "ok" ? "text-[var(--color-good)]" : "text-[var(--color-risk)]"}>
                {flash.kind === "ok" ? "✓ " : "✗ "}
                {flash.msg}
              </span>
            )}
          </div>
          {/* Accent here is earned: it is the single committing action of an opened form. */}
          <Button type="submit" disabled={!valid || busy} variant="primary">
            {busy ? "Saving…" : "Log entry"}
          </Button>
        </div>
      </form>
    </details>
  );
}

function Field({
  label,
  hint,
  hintBad,
  className,
  children,
}: {
  label: string;
  hint?: string;
  hintBad?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className ?? ""}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">{label}</span>
        {hint && (
          <span
            className={`font-mono text-[10px] ${hintBad ? "text-[var(--color-danger)]" : "text-[var(--color-fg-dim)]"}`}
          >
            {hint}
          </span>
        )}
      </span>
      {children}
    </label>
  );
}

function formatMinutes(min: number): string {
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}

// Deep Field tokens. The compatibility aliases the fields used still resolve, but pointing them at
// the real tokens is what makes the form sit in the same material as the page around it.
const inputClass =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-t1)] outline-none placeholder:text-[var(--color-t3)] focus:border-[var(--color-accent)]";

const selectClass = inputClass + " appearance-none pr-8";
