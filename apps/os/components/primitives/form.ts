// components/primitives/form — shared field styling for the write surfaces.
//
// Every form in the product had been carrying its own copy of the same input/select/label classes,
// which is why they drifted apart: some kept the pre-rewrite `--color-border-hi` aliases, some had
// their own focus color, and each one had to be found and fixed separately during a migration.
//
// These are CLASS STRINGS, not components. Forms differ too much in layout to share a wrapper, but
// they should never differ in what an input looks like. Kept in a .ts file (no JSX) so client and
// server components can both import it without pulling React in.

/** A text/url/date/number input, or a textarea. */
export const INPUT_CLASS =
  "w-full rounded-[var(--radius-sm)] border border-[var(--color-line-strong)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-t1)] outline-none transition-colors duration-[120ms] placeholder:text-[var(--color-t3)] focus:border-[var(--color-accent)] disabled:opacity-50";

/** A select. Same box as INPUT_CLASS, with room for the native chevron. */
export const SELECT_CLASS = `${INPUT_CLASS} appearance-none pr-8`;

/** The small mono caption above a field. Matches `t-label` used elsewhere. */
export const FIELD_LABEL_CLASS = "t-label text-[var(--color-t3)]";

/** A checkbox, tinted to the accent so its checked state reads as a deliberate choice. */
export const CHECKBOX_CLASS = "size-3.5 accent-[var(--color-accent)]";

/** An inline error message beneath a field or form. */
export const FORM_ERROR_CLASS = "t-meta text-[var(--color-risk)]";