# Pitfalls

Every entry is a mistake that was actually made on a 100-prospect audit in September 2026, with what it
cost and the rule that prevents it. They are ordered by how much damage they do.

---

## 1 · Falling through to a name guess when the real domain fails

**What happened.** Candidates were probed in confidence order and the first answer won. When a
prospect's own email domain did not respond, the loop continued to the name-guessed domain — which
answered, because *somebody* owns it.

`AKD Construction`'s email is `@akdconstruction.net` (dead). The guess `akdconstruction.com` resolved to
an **Ohio** construction company. Its site was audited, rated `outdated`, and written to the prospect.
Four other rows failed identically: `Athena`, `A Plus Cleaning`, `1 Stop Garage`, `A Smog`.

**Cost.** 5 of 70 recorded sites belonged to the wrong company — undetected until the operator asked
whether phone and geography had been cross-checked. They had not.

**Rule.** A failed strong candidate ends the search. Record *"their own domain does not respond"*. Never
promote a weak candidate into the slot a strong one vacated.

---

## 2 · Concluding "no website" from a failed lookup

**What happened.** Three prospects were marked `website_quality = 'none'` — the highest-priority verdict,
worth +30 — because a guessed domain turned out to be parked. The contacts used gmail/yahoo, so nothing
tied those domains to them at all.

`A Plus Cleaning` was the clearest: marked "no website", it has a perfectly good site at
`apluscleaningsf.com`, matching its record's `650-771-` phone prefix and naming Menlo Park.

**Cost.** 3 of 4 top-priority leads were wrong, in the direction most likely to waste a sales call.

**Rule.** `none` requires the business's **own** domain to be parked, for sale, or 404. Anything else is
unverified. Before concluding a business has no site, try the obvious variants of their own name
(`<name>sf.com`, `<name>inc.com`) and a Places lookup.

---

## 3 · Trusting HTML signals for a quality verdict

**What happened.** A classifier read viewport, doctype, generator, legacy markup and copyright year, and
assigned `none` / `outdated` / `acceptable` / `modern`. On the first 15 ambiguous rows checked visually
it was **wrong on 8**.

- called `2K`, `Asian Box`, `Avedas Build` *parked* — the words "coming soon" appeared in unrelated copy
- **missed** two real GoDaddy parking pages, rating them `outdated`
- called `All Reasons Moving` and `Air Perfection HVAC` *modern* — both visibly dated on screen

**Cost.** Every remaining bucket had to be re-reviewed: 64 more screenshots.

**Rule.** Signals triage and supply evidence. A screenshot decides. Contact sheets make 79 sites
reviewable in eight images.

---

## 4 · Ambiguous place names passing as geography

**What happened.** A NorCal city-name regex matched "Newark" on a site that was Newark, **Ohio**. Area
code 740 was on the same page and went unnoticed because the city match had already satisfied the test.

**Rule.** A city name alone is never geographic proof. Corroborate with an area code or ZIP, and treat an
out-of-state area code as a strong negative that overrides a city match.

---

## 5 · Not distinguishing a broken certificate from a dead server

**What happened.** Six domains "did not respond" and were filed as unknown. Re-checking with verified
TLS, TLS-ignored and plain http separately showed three different situations — including two sites that
are **up and working but serve an invalid certificate**, so every real visitor meets a full-page browser
warning.

`fractured9.com`, an architecture firm, turned out to be the strongest lead in the batch. It had been
recorded as "nothing answered".

**Rule.** Always probe all three ways. The gap between them *is* the finding.

---

## 6 · Auditing the same company repeatedly

**What happened.** 100 prospect rows covered 89 distinct businesses. `Accel` appeared 5×, `Add Life` 3×,
`Bajis Cafe` 2× — multiple contacts at one organisation. Each got its own fetch and screenshot.

**Rule.** Deduplicate by resolved domain before fetching. Audit the site once, apply the verdict to every
row sharing it.

---

## 7 · Auditing organisations that are not prospects

**What happened.** The batch included Stanford, PG&E, Apple, Accel, AppsFlyer, Applied Materials and a
school district — 24 % of rows. `Airity Technologies` had been **acquired**; its domain now redirects to
the acquirer, whose modal says so.

**Rule.** Filter `.edu` / `.gov` and known large corporates before spending requests. Watch rendered
pages for "has joined" / "is now part of" — an acquisition means the lead is dead, which is itself worth
recording.

---

## 8 · Long serial runs against third parties

**What happened.** Unrelated, but the same session lost 12 minutes to a 3,386-row import that made ~3
round trips per row inside one transaction, and timed out its own client twice.

**Rule.** Concurrency ~5–6, a 12-second timeout, cap the body at ~400 KB, identify the crawler in
`User-Agent`, and never hold a database transaction open across third-party latency.
