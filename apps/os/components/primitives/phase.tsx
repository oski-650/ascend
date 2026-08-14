// components/primitives/phase — the project progression primitives.
//
// Data shape is reused from core/production (`Phase`, `ChecklistItem`); the OLD visual treatment
// (components/PhaseLadder, components/PhaseChecklist) is deliberately not carried over.
//
// The design goal is that four questions are answerable at a glance without reading:
//   WHERE IS IT      — the rail, with the active phase marked
//   WHAT IS DONE     — completed phases are quiet, not loud
//   WHAT IS OPEN     — open task counts sit on the phase that owns them
//   WHAT IS BLOCKING — the active phase is the only thing given emphasis

import type { ChecklistItem, PhaseStatus } from "@/domain";
import type { Phase } from "@/core/production";
import { Status, type Tone } from "./index";

const STATUS_TONE: Record<PhaseStatus, Tone> = {
  complete: "good",
  in_progress: "accent",
  not_started: "neutral",
  skipped: "neutral",
};

const STATUS_LABEL: Record<PhaseStatus, string> = {
  complete: "complete",
  in_progress: "in progress",
  not_started: "not started",
  skipped: "skipped",
};

/**
 * The phase rail — the project's position expressed spatially.
 *
 * Each segment is sized equally and filled by its own progress, so the rail reads as a single
 * continuous journey rather than five separate progress bars. Status is carried by fill AND by the
 * marker glyph beneath, so removing color removes no information.
 */
export function PhaseRail({ phases, activeIndex }: { phases: Phase[]; activeIndex: number | null }) {
  return (
    <div>
      <div className="flex items-end gap-1.5">
        {phases.map((phase, i) => {
          const isActive = i === activeIndex;
          const done = phase.status === "complete";
          const skipped = phase.status === "skipped";
          const fill = done ? 100 : skipped ? 0 : phase.progress;
          const color = done
            ? "var(--color-good)"
            : isActive
              ? "var(--color-accent)"
              : "var(--color-line-strong)";

          return (
            <div key={phase.key} className="flex min-w-0 flex-1 flex-col gap-2">
              <span
                className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-line-strong)]"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${fill}%`, background: color }}
                />
              </span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className="t-mono shrink-0"
                  style={{
                    color: done
                      ? "var(--color-good)"
                      : isActive
                        ? "var(--color-accent)"
                        : "var(--color-t3)",
                  }}
                >
                  {done ? "●" : skipped ? "—" : isActive ? "◐" : "○"}
                </span>
                <span
                  className="t-label min-w-0 truncate"
                  style={{
                    color: isActive ? "var(--color-t1)" : done ? "var(--color-t2)" : "var(--color-t3)",
                  }}
                >
                  {phase.label}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One phase and its outstanding work.
 *
 * Completed phases collapse to a single line — finished work should recede. The active phase keeps
 * its open items visible, because that is the answer to "what is blocking progress".
 */
export function PhaseRow({ phase, isActive }: { phase: Phase; isActive: boolean }) {
  const open = phase.checklist.filter((c) => !c.done);
  const done = phase.checklist.filter((c) => c.done);
  const isDone = phase.status === "complete";

  return (
    <section
      className={`border-b border-[var(--color-line)] py-4 last:border-b-0 ${isDone ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3
          className="t-h2"
          style={{ color: isActive ? "var(--color-accent)" : "var(--color-t1)" }}
        >
          {phase.label}
          {isActive && <span className="t-label ml-2 text-[var(--color-t3)]">current</span>}
        </h3>
        <div className="flex items-center gap-3">
          <Status tone={STATUS_TONE[phase.status]}>{STATUS_LABEL[phase.status]}</Status>
          <span className="t-mono text-[var(--color-t2)]">
            {done.length}/{phase.checklist.length}
          </span>
        </div>
      </div>

      {phase.checklist.length === 0 ? (
        <p className="t-meta mt-2 text-[var(--color-t3)]">No checklist items.</p>
      ) : open.length === 0 ? (
        <p className="t-meta mt-2 text-[var(--color-t3)]">All items complete.</p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-1.5">
          {open.map((item, i) => (
            <TaskRow key={`${phase.key}-${i}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A single open checklist item. Read-only here by design: toggling a task is a WRITE, and writes go
 * through the existing production toggle route on the legacy surface — this slice does not
 * introduce a second mutation path.
 */
export function TaskRow({ item }: { item: ChecklistItem }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className="mt-[7px] size-1.5 shrink-0 rounded-full border border-[var(--color-t3)]"
      />
      <span className="t-body min-w-0 text-[var(--color-t2)]">{item.text}</span>
    </li>
  );
}