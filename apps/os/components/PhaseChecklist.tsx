import type { Phase } from "@/lib/production";
import { TaskStartButton } from "./TaskStartButton";
import { CheckboxToggle } from "./CheckboxToggle";

const STATUS_ACCENT: Record<Phase["status"], string> = {
  complete: "text-[var(--color-accent)]",
  skipped: "text-[var(--color-fg-dim)]",
  in_progress: "text-amber-300",
  not_started: "text-[var(--color-fg-dim)]",
};

export function PhaseChecklist({
  phase,
  clientSlug,
}: {
  phase: Phase;
  clientSlug?: string;
}) {
  const accent = STATUS_ACCENT[phase.status];
  const dates = [
    phase.started ? `started ${phase.started}` : null,
    phase.completed ? `completed ${phase.completed}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 sm:p-5">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest">
          <span className={`size-1.5 rounded-full ${accentDot(phase.status)}`} />
          <span className="text-[var(--color-fg)]">{phase.label}</span>
          <span className={`text-[10px] ${accent}`}>· {phase.status.replace("_", " ")}</span>
          {phase.status === "in_progress" && (
            <span className="text-[10px] text-amber-300">· {phase.progress}%</span>
          )}
        </h3>
        {dates && (
          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">{dates}</span>
        )}
      </header>

      {phase.checklist.length === 0 ? (
        <p className="font-mono text-xs text-[var(--color-fg-dim)]">
          {phase.status === "complete" || phase.status === "skipped"
            ? "(no checklist · phase resolved)"
            : "(no checklist defined yet)"}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {phase.checklist.map((item, i) => {
            const startable =
              clientSlug !== undefined &&
              !item.done &&
              phase.status !== "complete" &&
              phase.status !== "skipped";
            // Interactive checkbox when we have a client context; otherwise read-only.
            if (clientSlug !== undefined) {
              return (
                <div key={i} className="flex items-center gap-2">
                  <CheckboxToggle
                    client={clientSlug}
                    phase={phase.key}
                    itemIndex={i}
                    initialDone={item.done}
                    text={item.text}
                  />
                  {startable && (
                    <TaskStartButton client={clientSlug} phase={phase.key} task={item.text} size="xs" />
                  )}
                </div>
              );
            }
            return (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span
                  className={`mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded border font-mono text-[10px] ${
                    item.done
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                      : "border-[var(--color-fg-dim)]/40 text-transparent"
                  }`}
                  aria-hidden
                >
                  {item.done ? "✓" : ""}
                </span>
                <span
                  className={`flex-1 ${
                    item.done
                      ? "text-[var(--color-fg-dim)] line-through"
                      : "text-[var(--color-fg)]"
                  }`}
                >
                  {item.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function accentDot(s: Phase["status"]): string {
  switch (s) {
    case "complete":
      return "bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent)]";
    case "in_progress":
      return "bg-amber-400 shadow-[0_0_8px_rgb(251_191_36/0.7)]";
    case "skipped":
      return "bg-[var(--color-fg-dim)]/60";
    default:
      return "bg-[var(--color-fg-dim)]/40";
  }
}
