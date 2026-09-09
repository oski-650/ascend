// core/research/candidates — WHERE A PROSPECT'S WEBSITE MIGHT BE, as a pure function.
//
// ─── THIS FILE PROPOSES. IT NEVER CONCLUDES. ───────────────────────────────────────────────────
//
// It turns what a prospect record already says into an ordered list of addresses worth checking.
// It performs no I/O, reaches no network, and decides nothing about whether a business HAS a
// website — `./probe` answers that, and only for addresses this hands it.
//
// The separation matters because the two halves fail differently. A bad candidate costs one HTTP
// request. A bad CONCLUSION writes a claim about a business into the database, and the one claim
// that matters here is worth +30 in `computeScore` — exactly the `warm` threshold.
//
// ─── THE EMAIL DOMAIN IS THE STRONGEST SIGNAL IN THIS DATASET, AND IT IS FREE ──────────────────
//
// Measured on the 3,102 imported leads: 2,919 have an email, and 1,215 of those use a domain the
// business itself owns rather than a free provider — 890 distinct domains — against 37 websites
// recorded. `info@propshoprichmond.com` is not a hint that Prop Shop might have a website; it is
// the business publishing its own domain. Checking it costs one request and no third-party service.
//
// A free-provider address says the OPPOSITE of nothing: `gmail.com` is evidence about Google, not
// about the prospect, so those addresses yield no candidate at all rather than a weak one.

/**
 * Addresses that belong to a mail provider, never to the business writing from them.
 *
 * Drawn from the actual imported list rather than from a generic blocklist — `pacbell.net` and
 * `sbcglobal.net` are here because Bay Area contractors really use them. A domain missing from this
 * set becomes a candidate and is then PROBED, so the cost of an omission is one wasted request and
 * a `no site found` outcome, never a false claim.
 */
const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com",
  "hotmail.com", "outlook.com", "live.com", "msn.com", "passport.com",
  "aol.com", "icloud.com", "me.com", "mac.com",
  "comcast.net", "sbcglobal.net", "att.net", "pacbell.net", "verizon.net",
  "sonic.net", "earthlink.net", "juno.net", "charter.net", "cox.net",
  "protonmail.com", "proton.me", "gmx.com", "mail.com", "zoho.com", "yandex.com",
]);

/**
 * Where a candidate came from. Carried into the evidence so a reviewer can weigh a finding without
 * re-deriving it — "we found this because the contact writes from that domain" is a different
 * quality of fact from "we guessed it from the business name and it happened to resolve".
 */
export type CandidateBasis = "contact_email_domain" | "business_name_guess";

export type Candidate = {
  readonly domain: string;
  readonly basis: CandidateBasis;
};

/** The registrable part of an email address, lowercased. Null for anything that is not one. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const m = /^[^@\s]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec(email.trim());
  if (!m) return null;
  return m[1].toLowerCase().replace(/\.+$/, "");
}

/** True when the address belongs to a mail provider rather than to the business. */
export function isFreeProvider(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * A `.com` guessed from the business name — the WEAK candidate, and deliberately only one.
 *
 * Generating `.net`, `.biz`, `.co` and hyphenated variants would multiply outbound requests by five
 * for a population of 3,000 while making a false positive likelier: parked and squatted domains
 * resolve, and the more spellings tried the better the odds of hitting one that has nothing to do
 * with this business. One conservative guess, clearly labelled as a guess in the evidence.
 *
 * Returns null when the name yields nothing usable — a name that is only punctuation, or that
 * collapses to something too short to be a plausible domain.
 */
export function nameGuess(name: string | null | undefined): string | null {
  if (!name) return null;
  const stem = name
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")   // strip accents before dropping non-ascii
    // Legal suffixes and joining words are dropped: "Jams Co Handyman & Plumbing" is far likelier to
    // live at jamscohandyman.com than at jamscohandymanandplumbing.com.
    .replace(/\b(inc|llc|l\.l\.c|ltd|corp|corporation|co|company|the|and|of)\b/g, " ")
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "");
  if (stem.length < 4 || stem.length > 40) return null;
  return `${stem}.com`;
}

/**
 * Every address worth checking for this prospect, best first.
 *
 * ORDER IS THE CONFIDENCE RANKING, and the caller stops at the first address that answers — so a
 * business whose contact writes from its own domain is never attributed a guessed one. Duplicates
 * are collapsed: when the email domain and the name guess agree, that is one address to check, and
 * the stronger basis is the one recorded.
 *
 * A prospect that already HAS a website yields nothing. Re-deriving a candidate for a record that
 * already states its site would either confirm what is known or contradict it, and this module has
 * no standing to overwrite a stated fact.
 */
export function candidatesFor(prospect: {
  name?: string | null;
  contactEmail?: string | null;
  website?: string | null;
}): readonly Candidate[] {
  if (prospect.website && prospect.website.trim() !== "") return [];

  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (domain: string | null, basis: CandidateBasis) => {
    if (!domain || seen.has(domain)) return;
    seen.add(domain);
    out.push({ domain, basis });
  };

  const fromEmail = emailDomain(prospect.contactEmail);
  if (fromEmail && !isFreeProvider(fromEmail)) push(fromEmail, "contact_email_domain");
  push(nameGuess(prospect.name), "business_name_guess");

  return out;
}
