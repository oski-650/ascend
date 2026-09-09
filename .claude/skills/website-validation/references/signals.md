# Signals, and what each one is worth

Every weight here was checked against a real batch of 100 prospects and 79 live sites. Where a signal
proved unreliable, that is recorded rather than removed — knowing a signal is weak is worth more than
not having tried it.

## Parking / for-sale

| Signal | Strength | Note |
|---|---|---|
| NS hostname matches a parking provider | **decisive** | `forsale.hugedomainsdns.com`, `ns*.afternic.com`, `ns[12].sedoparking.com` |
| NS in the MISP parking list | **decisive** | 129 entries, maintained; match the registrable domain |
| Page is a known marketplace listing | **decisive** | HugeDomains, GoDaddy Auctions, Sedo, Dan.com, Afternic — check the rendered page |
| A record in a parking provider's range | **weak — do not hardcode** | see the note below |
| Bare `Index of /` directory listing | strong | server up, nothing published |
| Very low text-to-HTML ratio, most text inside links | moderate | the academic signal; noisy alone |
| NS is `*.domaincontrol.com` (GoDaddy) | **worthless** | serves parked *and* real sites — measured both ways in one sample |
| The words "coming soon" / "under construction" anywhere in the body | **worse than worthless** | produced 3 false positives in 15; real sites use these words in unrelated copy |

## Identity — is the site theirs?

| Signal | Strength |
|---|---|
| Domain is the contact's own email domain | **near-certain** |
| Their exact phone (digits-only compare) appears on the page | **strong** |
| Same `NPA-NXX` phone prefix, different last four | strong — usually a second line at the same business |
| Their email or its domain appears on the page | strong |
| Business name appears in `<title>` | moderate |
| Domain guessed from the business name, nothing else | **none — do not record on this alone** |

Fetch `/`, `/contact`, `/contact-us`, `/about`. NAP conventionally sits in the header, footer and
contact page.

### Why IP-based parking detection is not listed as strong

Published write-ups name `34.102.136.180` and `34.98.99.30` as GoDaddy's free-parking addresses. Those
were checked against two **confirmed** GoDaddy parking pages in September 2026 and did not match —
`apluscleaning.com` resolved to `76.223.67.189` / `13.248.213.45` and `artecfab.com` to `3.33.130.190` /
`15.197.148.33`, both AWS Global Accelerator ranges. The published values are stale.

Parking IPs move. Match on **nameservers and the rendered page**, which are stable and observable, and
do not hardcode an address range from any document — including this one.

## Geography (Northern California)

| Signal | Strength |
|---|---|
| NorCal area code on the page: `415 650 408 510 925 707 831 209 530 916 669 628` | strong |
| ZIP in a NorCal range, in a `, CA 9xxxx` pattern | strong |
| NorCal city name **plus** a corroborating area code or ZIP | strong |
| NorCal city name alone | **weak — ambiguous** |
| Another state named, or an out-of-state area code | strong **negative** |

Ambiguous city names that appear in multiple states: **Newark**, Richmond, Fremont, Concord, Antioch,
Vallejo, Napa, Danville, Alameda, Salem, Springfield, Columbus, Franklin. A city match with no area code
or ZIP behind it is not evidence.

## Quality

Only after identity has passed, and only alongside a rendered screenshot.

### Outdated
| Signal | Strength |
|---|---|
| Invalid / expired TLS certificate | **decisive** — visitors see a full-page browser warning |
| No `<meta name="viewport">` | **strong** — not responsive |
| http only, no TLS | strong |
| `<font>`, `<center>`, `<marquee>`, `bgcolor=`, `<frameset>`, Flash | strong |
| ≥ 4 `<table>` elements suggesting table layout | moderate |
| jQuery 1.x | moderate |
| Copyright year before 2020 | moderate |
| Dead social links — Google+ (shut down 2019), Vine, Flash badges | moderate; excellent outreach hook |

### Modern
| Signal |
|---|
| `viewport` + HTTPS + `og:` tags + flex/grid CSS + `loading="lazy"` |
| Current site builder: Webflow, Framer, Shopify, Squarespace, recent WordPress |
| Modern framework markers: `__NEXT_DATA__`, `data-reactroot`, `astro-island`, `ng-version` |
| Copyright year ≥ current year − 1 |

**All of these are triage.** A site can carry every "modern" marker and still look like 2012 — being
technically responsive is not the same as being good. In one batch, `All Reasons Moving & Storage` and
`Air Perfection HVAC` passed every automated modern check and were visibly dated on screen.

## Objective scoring

`lib/lighthouse.ts` → `runPsiAudit(url, strategy)` returns performance / accessibility / best-practices /
SEO via the PageSpeed Insights API (`PAGESPEED_API_KEY`). Use it where a number must be defended, and
run `strategy: "mobile"` — a small-business prospect's traffic is mostly phones, and it is the mobile
score that makes the sales case.

## Base rates worth knowing

From one 100-row batch of a purchased Bay Area list:

- 79 % of candidate domains answered
- ~1 in 13 apex domains on the internet is parked
- 15 % of contacts used free email — no company domain to derive anything from
- 24 % were not plausible SMB targets (universities, VC firms, large corporates, schools)
- 11 % of rows covered a business already represented by another row (multiple contacts at one company)
