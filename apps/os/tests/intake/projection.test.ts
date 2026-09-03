// Layer A — 2C · ASCEND FOUND, derived from a row (§1.4, §7.3(c)).
//
// Pure mapping, so no database: this file decides WHAT a row supports, and `tests/db/intake-*`
// proves what the writer then does with it. Splitting them keeps each honest — a mapping test that
// needed Postgres would be measuring two things and locating neither.

import { describe, expect, it } from "vitest";
import { projectRow, type ColumnMap } from "@/core/intake/projection";

const MAP: ColumnMap = {
  name: "Business", website: "Site", business_type: "Type", location: "City",
  contact_name: "Contact", contact_phone: "Phone", contact_email: "Email",
  source: "Source", notes: "Notes", status: "Status", website_quality: "Quality",
  project_urgency: "Urgency", decision_maker_access: "DM", niche_alignment: "Niche",
};

const project = (cells: Record<string, string>) => projectRow(cells, MAP);

describe("§1.4 · an empty cell is a fact about the sheet, never a value on the prospect", () => {
  it("a PRESENT BUT BLANK website does not become website_quality: none", () => {
    // The failure §1.4 names outright. The sheet had the column and left it blank; that is not a
    // claim that the business has no website.
    const p = project({ Business: "Acme", Site: "", Quality: "" });
    expect(p.kind).toBe("project");
    if (p.kind !== "project") return;
    expect("website" in p.input, "a blank cell was written as a value").toBe(false);
    expect("websiteQuality" in p.input, "a blank quality became a stated quality").toBe(false);
  });

  it("an ABSENT column and a BLANK cell reach the same place — unstated", () => {
    const absent = project({ Business: "Acme" });
    const blank = project({ Business: "Acme", Site: "" });
    if (absent.kind !== "project" || blank.kind !== "project") throw new Error("expected projections");
    expect("website" in absent.input).toBe(false);
    expect("website" in blank.input).toBe(false);
  });

  it("a STATED value IS written — the non-vacuity control", () => {
    // Without this, a mapper that wrote nothing at all would satisfy every assertion above.
    const p = project({ Business: "Acme", Site: "https://acme.example", City: "Modesto" });
    if (p.kind !== "project") throw new Error("expected a projection");
    expect(p.input.website).toBe("https://acme.example");
    expect(p.input.location).toBe("Modesto");
  });

  it("whitespace-only is blank, and a stated value is trimmed for the projection", () => {
    const p = project({ Business: "  Acme  ", City: "   " });
    if (p.kind !== "project") throw new Error("expected a projection");
    expect(p.input.name, "the projection did not normalise a padded name").toBe("Acme");
    expect("location" in p.input, "whitespace was treated as a stated value").toBe(false);
  });
});

describe("closed vocabularies are validated, never guessed", () => {
  it("an unrecognised status is UNSTATED, not coerced to a neighbour", () => {
    const p = project({ Business: "Acme", Status: "prospecting" });
    if (p.kind !== "project") throw new Error("expected a projection");
    expect("status" in p.input, "Ascend invented a status the sheet did not state").toBe(false);
  });

  it("a recognised status is accepted case-insensitively — the control", () => {
    const p = project({ Business: "Acme", Status: "Closed-Won" });
    if (p.kind !== "project") throw new Error("expected a projection");
    expect(p.input.status).toBe("closed-won");
  });

  it("an unrecognised boolean is UNSTATED, never false", () => {
    // "`false` here would be a positive claim that we checked" — 001, one field over.
    const p = project({ Business: "Acme", DM: "maybe", Niche: "no" });
    if (p.kind !== "project") throw new Error("expected a projection");
    expect("decisionMakerAccess" in p.input, "'maybe' was resolved to a boolean").toBe(false);
    expect(p.input.nicheAlignment, "a stated 'no' was lost").toBe(false);
  });
});

describe("a row with no name is not a business", () => {
  it("skips, with a reason, rather than projecting an anonymous prospect", () => {
    const empties: Record<string, string>[] = [{}, { Business: "" }, { Business: "   " }];
    for (const cells of empties) {
      const p = project(cells);
      expect(p.kind, `${JSON.stringify(cells)} produced a prospect`).toBe("skipped");
      if (p.kind === "skipped") expect(p.reason).toBe("no name");
    }
  });
});

describe("A HUMAN JUDGED is unreachable from this path", () => {
  it("no projection ever carries a judgment field", () => {
    // Belt and braces over a TYPE guarantee: `CreateProspectInput` has no websiteOpportunity,
    // assessedBy or assessedAt, so this cannot fail without the writer's input type changing —
    // which is exactly the change that should make a test go red.
    const p = project({
      Business: "Acme", Site: "x", Type: "Roofing", City: "Modesto", Contact: "Sam",
      Phone: "1", Email: "a@b.c", Source: "sheet", Notes: "n", Status: "lead",
      Quality: "modern", Urgency: "high", DM: "yes", Niche: "yes",
    });
    if (p.kind !== "project") throw new Error("expected a projection");
    for (const forbidden of ["websiteOpportunity", "assessedBy", "assessedAt", "assessed_by", "assessed_at"]) {
      expect(forbidden in p.input, `the import projected a judgment field: ${forbidden}`).toBe(false);
    }
    // And it did project the things it IS allowed to, so the assertion above is not vacuous.
    expect(Object.keys(p.input).length).toBeGreaterThan(10);
  });
});
