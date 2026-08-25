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
  unknown: "neutral",
};

// "unknown" is spelled out, never blanked or shown as "not started". The whole point of the state
// is that it is visible AS uncertainty — an unlabelled phase reads as one nobody has got to yet.
const STATUS_LABEL: Record<PhaseStatus, string> = {
  complete: "complete",
  in_progress: "in progress",
  not_started: "not started",
  skipped: "skipped",
  unknown: "unknown",
};

/**
 * The phase rail — the project's position expressed spatially.
 *
 * Each segment is sized equally and filled by its own progress, so the rail reads as a single
 * continuous journey rather than five separate progress bars. Status is carried by fill AND by the
 * marker glyph beneath, so removing color removes no information.
 *
 * `interactive` (default true) makes each segment an in-page link to its PhaseRow. The Production
 * INDEX renders the rail inside a row that is already one stretched link and has no phase detail
 * to jump to, so it passes `interactive={false}`: the segments become plain spans, which keeps a
 * single link per row and stops the rail from stealing five tab stops per build.
 */
export function PhaseRail({
  phases,
  activeIndex,
  interactive = true,
}: {
  phases: Phase[];
  activeIndex: number | null;
  interactive?: boolean;
}) {
  return (
    <nav aria-label="Project phases">
      <ol className="flex items-end gap-1.5">
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
          const open = phase.checklist.filter((c) => !c.done).length;

          // Same markup either way; only the element type changes. Non-interactive segments keep
          // `group` so the shared hover/transition classes below stay meaningful (they simply never
          // trigger), and keep the aria-label so the state is still announced.
          const Segment = interactive ? "a" : "span";

          return (
            <li key={phase.key} className="flex min-w-0 flex-1">
              {/* The rail doubles as navigation into the phase detail below — the same object at
                  two zoom levels, which is the whole interaction model. */}
              <Segment
                href={interactive ? `#phase-${phase.key}` : undefined}
                className="group flex min-w-0 flex-1 flex-col gap-2 rounded-[var(--radius-sm)] pb-1 pt-2 transition-colors duration-[140ms]"
                aria-label={`${phase.label}: ${phase.status.replace("_", " ")}, ${phase.progress}% complete${
                  open > 0 ? `, ${open} open` : ""
                }`}
              >
                <span
                  className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--color-line-strong)] transition-[height] duration-200 group-hover:h-[5px]"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full transition-[width] duration-700 ease-out"
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
                  {/* Below the breakpoint five labels cannot fit and all truncate to "ONBOAR…",
                      so they are hidden and the rail becomes purely positional — nothing is lost,
                      because the phase name is always restated in full nearby.
                      The threshold differs by context, measured rather than guessed:
                        interactive (Project view)  — `sm`; the PhaseRow list below repeats every
                                                      name, and at 768px the labels still fit.
                        static (Clients/Production) — `lg`; the rail sits inside an index row with
                                                      less usable width, and at 768px "Onboarding"
                                                      was measurably clipped. The row's own meta
                                                      line names the active phase in full. */}
                  <span
                    className={`t-label hidden min-w-0 truncate transition-colors duration-[140ms] group-hover:text-[var(--color-t1)] ${
                      interactive ? "sm:inline" : "lg:inline"
                    }`}
                    style={{
                      color: isActive
                        ? "var(--color-t1)"
                        : done
                          ? "var(--color-t2)"
                          : "var(--color-t3)",
                    }}
                  >
                    {phase.label}
                  </span>
                  {/* Sits immediately after its own label. `ml-auto` pushed it to the segment's
                      right edge, where it read as belonging to the NEXT phase. */}
                  {open > 0 && (
                    <span className="t-mono shrink-0 text-[var(--color-t3)]">{open}</span>
                  )}
                </span>
              </Segment>
            </li>
          );
        })}
      </ol>
    </nav>
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
      id={`phase-${phase.key}`}
      className={`scroll-mt-6 border-b border-[var(--color-line)] py-4 last:border-b-0 ${
        isDone ? "opacity-55" : ""
      }`}
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