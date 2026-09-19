// @vitest-environment happy-dom
//
// Slice 1C — THE INTERACTION FLOOR, AS A STYLESHEET CONTRACT.
//
// ─── WHAT THIS SUITE CANNOT SEE, SAID FIRST ────────────────────────────────────────────────────
//
// Every claim 1C makes is geometric: a 44px target, a 16px font, a checkbox hit area, a bar that
// covers rows. happy-dom applies NO stylesheet and has NO viewport, and it cannot evaluate
// `(pointer: coarse)` at all. A mounted assertion that a button "is 44px tall" would therefore pass
// with the rule, without the rule, and with the rule deleted — the vacuity 1B's debt names
// explicitly, and which the 1C contract forbids manufacturing.
//
// So this file claims no geometry. It asserts the SHAPE OF THE RULE — the condition it is written
// under, the scope it is confined to, and the exclusions that keep it off surfaces that own their
// own geometry. Those are facts about the source, and the source is where they live. The measured
// facts are the rendered CDP pass, and they are reported there.
//
// Each assertion below is discriminating: deleting the line it protects turns it red.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "..", "..");
const css = readFileSync(path.join(APP, "app", "globals.css"), "utf8");

/** The body of the one `@media` block the floor is written under, or null if it is not there. */
function floorBlock(): string | null {
  const start = css.indexOf("@media (pointer: coarse), (max-width: 767px) {");
  if (start === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return null;
}

/** Selector text of every rule in a block, with nested at-rules ignored. */
function selectorsIn(block: string): string[] {
  const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
  return [...body.matchAll(/(^|\})\s*([^{}@]+?)\s*\{/gs)]
    .map((m) => m[2].replace(/\/\*[\s\S]*?\*\//g, "").trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
}

/** Split a selector list on its TOP-LEVEL commas only — `:where(a, b)` is one compound, not two. */
function selectorList(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

describe("1C · the floor's CONDITION", () => {
  it("is written under pointer capability, with the width fallback stated in the same query", () => {
    // Decision 1. `(pointer: coarse)` is the real rule — it is what makes the floor true on a
    // tablet at 1024 and false on a mouse-driven desktop window at 390. The width term is the
    // documented fallback, and it is the shell's OWN breakpoint: 767 is where the rail is already
    // replaced by 1A's fixed trigger, so a window that narrow is already laid out as a phone.
    expect(floorBlock()).not.toBeNull();
    expect(css).toContain("@media (max-width: 767px) {"); // 1A's trigger clearance, same number
  });

  it("puts NOTHING on desktop: no floor rule exists outside that block", () => {
    // The mutation this catches is the tempting one — hoisting a rule "just for consistency" out of
    // the query, which silently enlarges every desktop screen and is exactly what Decision 1 refuses.
    const block = floorBlock()!;
    const outside = css.replace(block, "");
    expect(outside).not.toContain("--ascend-touch:");
    expect(outside).not.toMatch(/min-height:\s*var\(--ascend-touch\)/);
  });
});

describe("1C · the floor's SCOPE", () => {
  const block = floorBlock()!;
  const selectors = selectorsIn(block).filter((s) => s !== ":root");

  it("confines every rule to the operator column or the public column", () => {
    const stray = selectors.filter(
      (s) => !selectorList(s).every((part) => /\.ascend-main\b/.test(part) || /\.ascend-public\b/.test(part))
    );
    expect(stray, "a floor rule that escapes both columns reaches the shell's own furniture").toEqual([]);
  });

  it("holds the floor OFF the Galaxy, on every operator-column selector", () => {
    // 1B's invariant: the 3D Galaxy is the primary `/galaxy` experience, and it carries its own
    // measured phone geometry (`.galaxy-toolbar`, `.system-*`) from 1A/1B. This slice does not race
    // it on specificity — it excludes the route.
    const unguarded = selectors
      .flatMap(selectorList)
      .filter((part) => /\.ascend-main\b/.test(part) && !part.includes(":not(:has(> .galaxy-page))"));
    expect(unguarded, "an unguarded .ascend-main selector reaches the Galaxy").toEqual([]);
  });

  it("names the public column that /login renders into", () => {
    // Decision 3. `/login` is outside the operator shell, so `.ascend-main` cannot reach it; the
    // unauthenticated branch of the root layout carries the class this depends on.
    const layout = readFileSync(path.join(APP, "app", "layout.tsx"), "utf8");
    const publicMain = layout.match(/<main className="[^"]*"[^>]*>\{children\}<\/main>/);
    expect(publicMain?.[0]).toContain("ascend-public");
    expect(selectors.some((s) => s.includes(".ascend-public"))).toBe(true);
  });
});

describe("1C · what each rule floors", () => {
  const block = floorBlock()!;

  it("floors actions and form controls, and leaves links alone", () => {
    expect(block).toMatch(/:where\(button, \[role="button"\]\)/);
    expect(block).toMatch(/min-height: var\(--ascend-touch\)/);
    // Anchors are deliberately absent: the audit's small-target count includes prose links, and
    // growing those is the visual modernization this slice is not.
    expect(block).not.toMatch(/\ba\[href\]/);
  });

  it("gives form controls the 16px floor", () => {
    // Decision 2, on its own merits. The iOS focus-zoom mechanism is NOT claimed here or anywhere
    // else in this slice — it is unwitnessed and carried as debt.
    expect(block).toMatch(/font-size: 1rem/);
  });

  it("EXCLUDES checkboxes and radios from the form-control rule", () => {
    // The load-bearing exclusion. Without it the 44px min-height applies to a checkbox, which turns
    // a 14px control into a 44px square — the "visually bulky" outcome Decision 1 rules out, and a
    // change to how every option row reads rather than to how it is hit.
    // EVERY selector in the field rule — operator and public column alike — must carry it; a check
    // that finds the exclusion once passes while the other column quietly loses it.
    const fieldSelectors = selectorsIn(block).flatMap(selectorList).filter((part) => part.includes("textarea"));
    expect(fieldSelectors.length).toBe(2);
    for (const part of fieldSelectors) {
      expect(part, "the field rule must exclude checkbox and radio").toContain('input:not([type="checkbox"], [type="radio"]');
    }
  });

  it("gives the checkbox a 24px control and its wrapping label the full target", () => {
    // Activating a label toggles the input it wraps, so the label IS the target. The control grows
    // enough to be legible and hittable without dominating the row.
    expect(block).toMatch(/input:where\(\[type="checkbox"\], \[type="radio"\]\)/);
    expect(block).toMatch(/min-width: 24px/);
    expect(block).toMatch(/label:has\(> input:where\(\[type="checkbox"\], \[type="radio"\]\)\)/);
  });
});

describe("1C · D1 · the wipe panel's reserved band", () => {
  it("reserves the bar's height from ONE variable, at both breakpoints", () => {
    expect(css).toMatch(/\.ascend-wipe \{\s*--ascend-wipe-bar-h:/);
    // Declared on the SCROLLER too: a custom property inherits downwards only, so the ancestor
    // doing the scroll-padding cannot read one declared on the panel. The first cut did exactly
    // that and the rule fell back to `auto` — invalid at computed-value time, silent.
    expect(css).toMatch(/\.ascend-main:has\(\.ascend-wipe\),\s*\.ascend-wipe \{\s*--ascend-wipe-bar-h:/);
    expect(css).toMatch(/\.ascend-wipe-targets \{\s*padding-bottom: var\(--ascend-wipe-bar-h\)/);
    // Two measured bar heights — 145px stacked below 640, 99px in the row layout above it.
    const overrides = css.match(/--ascend-wipe-bar-h: [\d.]+rem/g) ?? [];
    expect(overrides.length).toBe(2);
  });

  it("tells the scroller where its usable bottom is", () => {
    // The half that changes behaviour rather than spacing: without it, focusing a checkbox under
    // the sticky bar scrolls it to the scrollport edge and leaves it covered — measured at 4 of 11
    // at 390×844. `scroll-padding-bottom` is what moves that to 0.
    expect(css).toMatch(/\.ascend-main:has\(\.ascend-wipe\) \{\s*scroll-padding-bottom: calc\(var\(--ascend-wipe-bar-h\)/);
  });

  it("is hooked to the panel by class, not by editing what the panel DOES", () => {
    const panel = readFileSync(path.join(APP, "components", "admin", "WipePanel.tsx"), "utf8");
    expect(panel).toContain('className="ascend-wipe"');
    expect(panel).toContain("ascend-wipe-targets");
    // The sticky affordance and the destructive contract survive the layout fix untouched.
    expect(panel).toContain("sticky bottom-4");
    expect(panel).toContain('confirm: "WIPE"');
  });
});
