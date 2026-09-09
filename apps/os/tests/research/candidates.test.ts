// core/research/candidates — where a website might be, as a pure function.
//
// The property under test is CONSERVATISM. Every case here is about the module declining to propose
// something, because the cost of a bad proposal is an outbound request to a stranger and, if it
// happens to answer, a wrong website recorded against a real business.

import { describe, expect, it } from "vitest";
import { candidatesFor, emailDomain, isFreeProvider, nameGuess } from "@/core/research/candidates";

describe("emailDomain", () => {
  it("takes the registrable part, lowercased", () => {
    expect(emailDomain("info@PropShopRichmond.com")).toBe("propshoprichmond.com");
    expect(emailDomain("  mia.lomas@menlo.edu  ")).toBe("menlo.edu");
  });

  it("answers null for anything that is not an address", () => {
    for (const bad of [null, undefined, "", "not-an-email", "@nodomain.com", "two@@at.com", "no@tld"]) {
      expect(emailDomain(bad)).toBeNull();
    }
  });
});

describe("isFreeProvider", () => {
  it("knows the providers that actually appear in this hit list", () => {
    // 1,702 of the imported leads use one of these. A domain here says something about the mail
    // provider and nothing about the business.
    for (const d of ["gmail.com", "yahoo.com", "sbcglobal.net", "pacbell.net", "comcast.net", "icloud.com"]) {
      expect(isFreeProvider(d), d).toBe(true);
    }
  });

  it("does not mistake a company domain for a provider", () => {
    for (const d of ["propshoprichmond.com", "crystalspringscatering.com", "menlo.edu"]) {
      expect(isFreeProvider(d), d).toBe(false);
    }
  });
});

describe("nameGuess", () => {
  it("drops legal suffixes and joining words", () => {
    expect(nameGuess("Jams Co Handyman & Plumbing")).toBe("jamshandymanplumbing.com");
    expect(nameGuess("Minear Electric Inc.")).toBe("minearelectric.com");
  });

  it("refuses a name too short or too long to be a plausible domain", () => {
    expect(nameGuess("2K")).toBeNull();
    expect(nameGuess("Co")).toBeNull();
    expect(nameGuess("A".repeat(60))).toBeNull();
  });

  it("refuses a name that is only punctuation or empty", () => {
    for (const n of [null, undefined, "", "   ", "---", "&&&"]) expect(nameGuess(n)).toBeNull();
  });
});

describe("candidatesFor", () => {
  it("prefers the company email domain over a name guess", () => {
    const c = candidatesFor({ name: "Prop Shop", contactEmail: "info@propshoprichmond.com" });
    expect(c[0]).toEqual({ domain: "propshoprichmond.com", basis: "contact_email_domain" });
    // The name guess is still offered, second — it is a fallback, not a competitor.
    expect(c[1]?.basis).toBe("business_name_guess");
  });

  it("proposes NOTHING from a free-provider address — only the name guess remains", () => {
    const c = candidatesFor({ name: "Pantoja Gardening", contactEmail: "jh3499740@gmail.com" });
    expect(c.map((x) => x.basis)).toEqual(["business_name_guess"]);
    expect(c.every((x) => x.domain !== "gmail.com")).toBe(true);
  });

  it("proposes nothing at all when the record says nothing usable", () => {
    expect(candidatesFor({ name: null, contactEmail: null })).toEqual([]);
    expect(candidatesFor({ name: "2K", contactEmail: "someone@yahoo.com" })).toEqual([]);
  });

  it("proposes nothing when a website is already recorded", () => {
    // This module has no standing to second-guess a stated fact.
    const c = candidatesFor({
      name: "Prop Shop", contactEmail: "info@propshoprichmond.com", website: "https://example.com",
    });
    expect(c).toEqual([]);
  });

  it("collapses a duplicate rather than probing the same address twice", () => {
    const c = candidatesFor({ name: "Minear Electric", contactEmail: "hi@minearelectric.com" });
    expect(c).toHaveLength(1);
    expect(c[0]).toEqual({ domain: "minearelectric.com", basis: "contact_email_domain" });
  });
});
