---
name: website-validation
description: Find and audit a prospect's website, then record a defensible verdict on its quality. Use when asked to check whether prospects have websites, to rate or rank prospects by site quality, to find a business's website, to detect outdated or parked sites, or to prioritise a lead list by web presence. Enforces the rule that Ascend may report what it looked at and never assert what it failed to find.
---

# Website validation

Turn "does this business have a website, and is it any good?" into a verdict that survives being questioned.

The output is written into `prospects.website` and `prospects.website_quality`, which feed `computeScore`
directly — `none` and `outdated` are worth **+30**, exactly the `warm` threshold. A careless verdict does
not just mislabel one row; it reorders the pipeline.

## The one rule

> **Report what you looked at. Never assert what you failed to find.**

A request that fails is consistent with the business having no site, and equally with slow DNS, a host
blocking datacentre traffic, an expired certificate, a JS-rendered page, or a domain nobody guessed.
Those are indistinguishable from the client side.

`website_quality = 'none'` is a claim that **this business has no website**. It is only permissible when
the business's **own** domain — one their email comes from, or one already on the record — resolves to a
parking page, a for-sale listing, or a 404. Everything else that fails is **unverified**, which is a
different thing from `none` and must be reported as such.

## Before anything: get a domain worth checking

Ranked by how much they prove. **The rank is the whole game** — most bad verdicts come from acting on a
weak candidate as if it were a strong one.

| Rank | Source | What it proves |
|---|---|---|
| 1 | `prospects.website` already recorded | someone asserted it |
| 2 | **The contact's own email domain** (not gmail/yahoo/…) | near-certain: their mail is hosted there |
| 3 | **Google Places** Text Search → Place Details `websiteUri`, queried as `"<name>, <city> CA"` | the business itself published it |
| 4 | A domain guessed from the business name | **nothing** |

**Never let a rank-4 guess substitute for a failed rank-2.** If their own domain does not answer, the
finding is *"their own domain does not respond"* — a real, valuable fact. It is not permission to go
looking for a domain that does.

> This is not hypothetical. `AKD Construction`'s email is `@akdconstruction.**net**`, which was dead.
> The runner fell through to the name guess `akdconstruction.**com**` — an **Ohio** company — and rated
> its site as the Menlo Park prospect's. Four other rows failed the same way in one batch of 100.

Rank 3 is the fix for contacts on free email (about **15%** of a typical purchased list have no company
domain at all). Places API and PageSpeed can share one Google Cloud project and key.

## The layers, in order

Each layer answers a question the one before it cannot. Do not skip to the verdict.

### 1 · DNS — is the domain parked?

Query `NS` and match the **full nameserver hostnames** (not their registrable domain) against
`forsale|for-sale|parking|sedopark|hugedomains|afternic|bodis|namebright|parkingcrew|above\.com|dan\.com|namefind`,
plus the maintained [MISP parking-nameserver list](https://raw.githubusercontent.com/MISP/misp-warninglists/main/lists/parking-domain-ns/list.json)
(129 entries).

A hit is **decisive**: `asmog.com` answers on `forsale.hugedomainsdns.com` / `domain-for-sale.hugedomains…`.

**A miss proves nothing, and this is measured, not assumed.** GoDaddy's `*.domaincontrol.com` serves
parked *and* real domains alike — in one sample it was the nameserver for two for-sale domains
(`apluscleaning.com`, `artecfab.com`) and two live business sites (`fractured9.com`, `adautogate.com`).
Never treat a shared registrar nameserver as evidence of parking. About 1 in 13 apex domains is parked,
so the base rate is real but low.

### 2 · HTTP — down, or just broken?

Fetch **three ways** and compare. The difference between them is the finding:

| verified TLS | TLS ignored | plain http | Means |
|---|---|---|---|
| 200 | 200 | — | site is up |
| **fail** | **200** | — | **certificate is invalid** — every real visitor gets a full-page browser warning |
| fail | fail | 200 | http-only, no TLS |
| fail | fail | fail | nothing serving |
| 404 | 404 | 404 | domain live, **no site** |

The second row is the most commercially interesting outcome in the whole process and a plain fetch
cannot see it — `curl` without `-k` and `curl -k` return the same failure to a naive script. Use `GET`,
not `HEAD`: a meaningful minority of small-business hosts answer `HEAD` with 405 while serving `GET`.

### 3 · Identity — is this site actually theirs?

**Mandatory before any quality verdict.** A same-named business in another state is the default failure
mode, not an edge case. Use **NAP consistency** (Name / Address / Phone), the standard local-SEO
framework, fetching `/`, `/contact`, `/contact-us` and `/about` — NAP conventionally lives in the
header, footer and contact page.

Accept the site as theirs on **any one** of:

- the domain is their own email domain (rank 2) — self-corroborating
- their phone appears on the page (compare digits only; accept a shared `NPA-NXX` prefix as strong)
- their email, or its domain, appears on the page
- the business name appears in `<title>`

Then check geography independently. For Northern California, area codes
`415 650 408 510 925 707 831 209 530 916 669 628`, and city names from the target region.

> **Watch for ambiguous place names.** "Newark" matched a NorCal city list while the site was Newark,
> **Ohio** — the giveaway was area code **740**. Always corroborate a city with an area code or ZIP.

If nothing ties the site to the business, stop. Record **unverified** and move on.

### 4 · Render before judging

A raw-HTML classifier is not good enough to rate a site, and this is measured: on the first 15
ambiguous cases it was **wrong on 8**. It called real sites "parked" because the words *coming soon*
appeared somewhere on the page, and missed actual GoDaddy parking pages entirely.

It also cannot see JS-rendered sites — `fractured9.com` returns no `<title>` to `curl` and a full page
in a browser.

**Load the page in headless Chrome and look at a screenshot before assigning `outdated` / `acceptable` /
`modern`.** Batch them into contact sheets (a local HTML page of `file://` images, screenshotted) to
review many at once. HTML signals are for *triage and evidence*, never for the final verdict.

### 5 · The verdict

`website_quality` is a closed vocabulary. Say only what you saw.

| Value | Means | Requires |
|---|---|---|
| `none` | the business has no website | their **own** domain is parked / for-sale / 404 |
| `outdated` | has one, and it is failing them | invalid cert, no viewport, http-only, legacy markup, visibly dated |
| `acceptable` | works, unremarkable | responsive, loads, nothing broken |
| `modern` | current and well-built | responsive + social meta + modern CSS/framework + recent copyright |
| *(unset)* | **you do not know** | anything else — and this is a legitimate outcome |

Objective corroboration for the middle two: the repo already has `lib/lighthouse.ts` → `runPsiAudit()`
scoring performance / accessibility / best-practices / SEO via `PAGESPEED_API_KEY`. Prefer it over
hand-rolled heuristics where a defensible number matters. It is not currently wired to prospects.

Concrete signals and their weights: `references/signals.md`.

## Writing the result

Write as `ascend_automation`. The schema forbids that role from writing `website_opportunity`,
`assessed_by` or `assessed_at` — the judgment columns belong to a human, and a research pass must not
touch them.

- Record `website` **only** when identity (layer 3) passed. A parking page is not their website: leave
  `website` NULL and put the parking URL in the event.
- Emit `prospect.website_researched` for every prospect examined, found or not, carrying the candidates
  tried, each probe's outcome, and the basis for the verdict. A run that concludes nothing still
  established that Ascend looked.
- Retracting is normal. When later evidence undermines a verdict, clear the fields and emit a
  correction event saying why. Do not quietly overwrite.

## Reporting

Give per-row **evidence, not just verdicts** — `identity_evidence` and `geography_evidence` columns turn
a list someone has to trust into one they can check. Separate "no website" from "could not verify"
everywhere; collapsing them is the single most misleading thing this process can do.

State the yield honestly: of 100 rows in one real batch, 89 were distinct businesses, 24 were not
plausible SMB targets (universities, VC firms, large corporates), and 33 ended unverified.

`references/pitfalls.md` lists the failures this skill was written from. Read it before a large run.
