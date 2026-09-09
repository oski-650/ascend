// core/crm/column-inference — what a header means, and what it must refuse to mean.
//
// The subject is a mapping, never a value. Every assertion here is about which COLUMN feeds which
// field; nothing in this module reads a cell, so §1.4's "an empty cell is a fact about the sheet"
// is not in play. What IS in play is the failure that produced 3,193 garbage prospects: a matcher
// confident enough to name a column it had not recognised.

import { describe, expect, it } from "vitest";
import { inferColumnMap } from "@/core/crm/column-inference";

describe("inferColumnMap · the ordinary sheet", () => {
  it("maps the import surface's own example", () => {
    const { map } = inferColumnMap(["name", "business_type", "location", "status", "website"]);
    expect(map).toEqual({
      name: "name",
      business_type: "business_type",
      location: "location",
      status: "status",
      website: "website",
    });
  });

  it("is indifferent to case, spacing and punctuation", () => {
    const { map } = inferColumnMap(["Business Name", "INDUSTRY", "city_state", "Contact-Email"]);
    expect(map.name).toBe("Business Name");
    expect(map.business_type).toBe("INDUSTRY");
    expect(map.location).toBe("city_state");
    expect(map.contact_email).toBe("Contact-Email");
  });

  it("returns headers exactly as the sheet spelled them", () => {
    // The projection looks cells up by the original key and the evidence keeps headers verbatim.
    // A normalised key in the map would miss in both.
    const { map } = inferColumnMap(["  Company  "]);
    expect(map.name).toBe("  Company  ");
  });

  it("reports every header it did not recognise", () => {
    const { map, unmapped } = inferColumnMap(["company", "record id", "internal ref"]);
    expect(map.name).toBe("company");
    expect(unmapped).toEqual(["record id", "internal ref"]);
  });
});

describe("inferColumnMap · the ordering bug it exists to prevent", () => {
  it("does not let contact_name's loose 'contact' swallow Contact Email", () => {
    // The old UI guess tested /(contact|owner)/ for contact_name before anything looked at email,
    // so this sheet bound the email column to the contact's NAME.
    const { map } = inferColumnMap(["company", "contact email"]);
    expect(map.contact_email).toBe("contact email");
    expect(map.contact_name).toBeUndefined();
  });

  it("binds both when the sheet really has both", () => {
    const { map } = inferColumnMap(["company", "contact name", "contact email", "contact phone"]);
    expect(map.name).toBe("company");
    expect(map.contact_name).toBe("contact name");
    expect(map.contact_email).toBe("contact email");
    expect(map.contact_phone).toBe("contact phone");
  });

  it("never binds one header to two fields", () => {
    const { map } = inferColumnMap(["email address", "company"]);
    const used = Object.values(map);
    expect(new Set(used).size).toBe(used.length);
    expect(map.contact_email).toBe("email address");
    expect(map.location).toBeUndefined(); // 'address' is not a loose pattern, for exactly this
  });

  it("never binds one field to two headers", () => {
    const { map, unmapped } = inferColumnMap(["company", "business"]);
    expect(map.name).toBe("company");
    expect(unmapped).toEqual(["business"]);
  });
});

describe("inferColumnMap · bare 'name' is the business", () => {
  it("maps a lone Name to the business, not the contact", () => {
    const { map } = inferColumnMap(["name", "city"]);
    expect(map.name).toBe("name");
    expect(map.contact_name).toBeUndefined();
  });

  it("prefers Company for the business and leaves an ambiguous Name unmapped", () => {
    const { map, unmapped } = inferColumnMap(["company", "name"]);
    expect(map.name).toBe("company");
    expect(unmapped).toEqual(["name"]);
  });

  it("takes First Name as the contact when a company column is present", () => {
    const { map } = inferColumnMap(["company", "first name", "email"]);
    expect(map.name).toBe("company");
    expect(map.contact_name).toBe("first name");
    expect(map.contact_email).toBe("email");
  });
});

describe("inferColumnMap · it refuses rather than guesses", () => {
  it("maps no name at all when nothing resembles one", () => {
    // THE 3,193-ROW FAILURE, as a unit test. The old surface did `guess.name = headers[0]` here,
    // so a numeric record id became the business name for every row in the sheet.
    const { map, unmapped } = inferColumnMap(["3624150", "ref", "xyz"]);
    expect(map.name).toBeUndefined();
    expect(unmapped).toEqual(["3624150", "ref", "xyz"]);
  });

  it("maps nothing from an empty header list", () => {
    expect(inferColumnMap([])).toEqual({ map: {}, unmapped: [] });
  });

  it("leaves blank headers unmapped", () => {
    const { map, unmapped } = inferColumnMap(["company", "", "   "]);
    expect(map.name).toBe("company");
    expect(unmapped).toEqual(["", "   "]);
  });

  it("does not claim a column on the strength of a generic word", () => {
    // 'fit' was dropped from niche_alignment: a wrong boolean there feeds computeScore directly.
    const { map } = inferColumnMap(["company", "fit"]);
    expect(map.niche_alignment).toBeUndefined();
  });
});

describe("inferColumnMap · a realistic purchased lead list", () => {
  it("maps what it recognises and reports the rest", () => {
    const { map, unmapped } = inferColumnMap([
      "Record ID", "Industry", "First Name", "Last Name", "Company",
      "Email", "Phone", "Website", "City", "State",
    ]);
    expect(map.name).toBe("Company");
    expect(map.business_type).toBe("Industry");
    expect(map.contact_name).toBe("First Name");
    expect(map.contact_email).toBe("Email");
    expect(map.contact_phone).toBe("Phone");
    expect(map.website).toBe("Website");
    expect(map.location).toBe("City");
    // Last Name has no field of its own: ColumnMap binds one header per field, and a composite
    // contact name is a change to the map's SHAPE, not to this matcher.
    expect(unmapped).toEqual(["Record ID", "Last Name", "State"]);
  });
});
