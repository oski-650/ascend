import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import path from "node:path";
import { hitListDir } from "@/lib/paths";
import { readTextFile } from "@/core/vault/markdown";
import { createProspect } from "@/core/crm";
import { extractFromHtml, locationString } from "@/lib/htmlExtract";
import { runPsiAudit } from "@/lib/lighthouse";
import { safeFetch, validateExternalUrl } from "@/lib/urlGuard";
import type { WebsiteQuality } from "@/domain";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "prospect";
}

/**
 * Map a MEASURED performance score to a website-quality band — or decline to answer (D-2).
 *
 * This returned `"acceptable"` for `perf === null`, which turned every FAILURE to measure into a
 * positive claim that Ascend had inspected the site and found it adequate. PSI times out, returns
 * 429 under an anonymous rate limit or an exhausted quota, and refuses URLs it cannot reach — so
 * the single most likely outcome at any volume was a vault full of unmeasured sites asserting
 * `website_quality: acceptable`.
 *
 * `null` here means "no quality claim", and the caller OMITS the frontmatter key entirely rather
 * than writing a blank or a placeholder. That matches how the CSV importer already treats an
 * unstated quality, and it is what makes the scorer's D-1 repair meaningful: a field that is
 * absent because nothing was established must stay absent.
 *
 * NO NEW DOMAIN VALUE. `WebsiteQuality` is unchanged — an unknown quality is the absence of a
 * quality, not a fifth member of the vocabulary.
 */
function deriveWebsiteQuality(perf: number | null): WebsiteQuality | null {
  if (perf === null) return null;
  if (perf >= 90) return "modern";
  if (perf >= 50) return "acceptable";
  return "outdated";
}

function fmtScoreLine(label: string, n: number | null, goodThreshold: number): string {
  if (n === null) return `- ${label}: —`;
  const emoji = n >= goodThreshold ? "🟢" : n >= goodThreshold / 2 ? "🟡" : "🔴";
  return `- **${label}:** ${n}/100 ${emoji}`;
}

function fmtMs(n: number | null): string {
  if (n === null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`;
}

/** Rule-based diagnosis lines from PSI numbers + platform fingerprint. */
function diagnose(
  psi: NonNullable<Awaited<ReturnType<typeof runPsiAudit>>>,
  platform: string | null
): string[] {
  const lines: string[] = [];
  const lcp = psi.cwv.lcp_ms;
  const fcp = psi.cwv.fcp_ms;
  const cls = psi.cwv.cls;
  const ttfb = psi.cwv.ttfb_ms;
  const perf = psi.scores.performance;

  if (lcp !== null && lcp > 4000) {
    lines.push(
      `**LCP at ${(lcp / 1000).toFixed(2)}s is well over the 2.5s "good" threshold.** Hero image on mobile is likely unoptimized — wrong format (JPEG/PNG instead of WebP/AVIF), no explicit dimensions, or loaded after JS instead of as a direct \`<img>\`.`
    );
  } else if (lcp !== null && lcp > 2500) {
    lines.push(`LCP at ${(lcp / 1000).toFixed(2)}s is borderline — fixable with image format + preload tweaks.`);
  }

  if (cls !== null && cls > 0.25) {
    lines.push(
      `**CLS at ${cls.toFixed(3)} is poor** (>0.25). Content shifts dramatically during load — usually missing \`width\`/\`height\` on images, async font swaps, or late-injected ads/banners.`
    );
  } else if (cls !== null && cls > 0.1) {
    lines.push(`CLS at ${cls.toFixed(3)} needs work — small but visible layout shifts during load.`);
  }

  if (fcp !== null && fcp > 3000) {
    lines.push(`FCP at ${(fcp / 1000).toFixed(2)}s is slow — server response or render-blocking CSS/JS is delaying first paint.`);
  }

  if (ttfb !== null && ttfb > 600) {
    lines.push(`TTFB at ${ttfb}ms suggests slow hosting or no caching layer. Could be a switch-hosts conversation.`);
  } else if (ttfb !== null && ttfb > 0 && ttfb < 100) {
    lines.push(`TTFB at ${ttfb}ms — hosting is fast (probably on a CDN). Not a server problem.`);
  }

  if (platform === "Wix") {
    lines.push(
      `**Wix platform — hard performance ceiling.** The Wix runtime ships a heavy JS bundle on every page load regardless of content. Optimization can only do so much; meaningful perf gains require migrating off Wix.`
    );
  } else if (platform === "Shopify") {
    lines.push(
      `Shopify — apps and theme blocks are usually the biggest perf drag. App audit + removing unused widgets often pays off without a full theme rebuild.`
    );
  } else if (platform === "WordPress") {
    lines.push(
      `WordPress — plugin bloat and theme weight are the usual suspects. Switch to a lighter theme (GeneratePress, Kadence) + plugin audit can move perf 20-30 points.`
    );
  } else if (platform === "Squarespace") {
    lines.push(
      `Squarespace — limited optimization knobs. Like Wix, real perf gains usually require migrating off-platform.`
    );
  } else if (platform === "Webflow") {
    lines.push(`Webflow — generally well-optimized out of the box. If perf is low, suspect heavy third-party embeds.`);
  } else if (platform === "Duda") {
    lines.push(`Duda — small-business focused builder, similar perf profile to Wix. Hard ceiling.`);
  }

  if (perf !== null && perf >= 90 && (lcp === null || lcp <= 2500) && (cls === null || cls <= 0.1)) {
    lines.push(`Site is already in good shape — green across the board. Not a perf-fix pitch; this is a maintenance / SEO / content play.`);
  }

  return lines;
}

/** Rule-based pitch angles ranked by relevance. */
function pitchAngles(
  psi: NonNullable<Awaited<ReturnType<typeof runPsiAudit>>>,
  platform: string | null,
  /** `null` when performance could not be measured — no band was established (D-2). */
  websiteQuality: WebsiteQuality | null
): string[] {
  const angles: string[] = [];
  const perf = psi.scores.performance ?? 100;
  const lcp = psi.cwv.lcp_ms ?? 0;
  const platformCeiling = platform === "Wix" || platform === "Squarespace" || platform === "Duda";

  // Primary engagement angle based on perf + platform
  if (websiteQuality === "outdated" || perf < 50) {
    angles.push(
      `**Full rebuild ($3-5k Growth/Ascend Pro tier).** Performance is too far gone for patches. Pitch a migration to ${platformCeiling ? "Shopify (if commerce) or custom Next.js" : "a modern stack"}. Kills any platform subscription as bonus value.`
    );
  } else if (perf < 85 && platformCeiling) {
    angles.push(
      `**Migration off ${platform} ($2.5-4k).** The only way to actually fix LCP/TBT is to leave ${platform}. Pitch a Shopify or custom Next.js rebuild — performance ceiling lifted + monthly platform subscription killed.`
    );
  } else if (perf < 85) {
    angles.push(
      `**Performance optimization ($500-1500, fixed-scope).** Targeted fixes — image formats, defer non-critical JS, preload LCP element. Could realistically move perf 20-30 points without a rebuild.`
    );
  } else {
    angles.push(
      `**Care plan retainer ($99-249/month).** Site is already healthy. Pitch monthly perf checks, content updates, security patches, and SEO trend monitoring. Recurring revenue play.`
    );
  }

  // LCP-specific quick-win angle
  if (lcp > 4000) {
    angles.push(
      `**LCP quick-win demo.** Hero image swap to WebP + \`fetchpriority="high"\` + \`<link rel="preload">\`. Single-engagement deliverable showing capability. Great lead-in to the bigger conversation.`
    );
  }

  // SEO angle if perf is fine but other things might lag
  if (perf >= 70 && (psi.scores.seo ?? 100) < 90) {
    angles.push(
      `**SEO audit ($400-800).** Site loads fine but SEO score is ${psi.scores.seo}. Targeted meta/schema/sitemap audit — fast turnaround, easy upsell into a care plan.`
    );
  }

  return angles;
}

export async function POST(req: Request) {
  return authorize(req, "prospects:write", async () => {
    try {
      const body = (await req.json()) as { url?: string; run_psi?: boolean; overwrite?: boolean };
      if (!body.url) return NextResponse.json({ error: "url is required" }, { status: 400 });

      // ─── Normalize + SSRF-validate the URL ───────────────────────────────────
      // This route fetches an operator-supplied URL server-side and persists the response into the
      // vault. Without validation it reached loopback (including this app's own API), RFC1918, and
      // cloud link-local metadata. validateExternalUrl enforces http(s)-only, no embedded
      // credentials, and that every resolved address is public.
      const guarded = await validateExternalUrl(body.url);
      if (!guarded.ok) {
        return NextResponse.json({ error: guarded.reason }, { status: 400 });
      }
      const url = guarded.url;
      const fullUrl = url.toString();
      const runPsi = body.run_psi !== false;

      // ─── Fetch the site (15s timeout) ────────────────────────────────────────
      // safeFetch follows redirects MANUALLY, re-validating each hop — a public host redirecting to a
      // private address is the standard bypass of a fetch-time-only check.
      const fetchController = new AbortController();
      const fetchTimer = setTimeout(() => fetchController.abort(), 15_000);
      let html = "";
      let fetchOk = false;
      try {
        const result = await safeFetch(url, {
          signal: fetchController.signal,
          headers: { "User-Agent": "AscendOS/1.0 (+prospect-intake)" },
        });
        if (result.ok && result.response.ok) {
          html = await result.response.text();
          fetchOk = true;
        }
      } catch {
        /* leave fetchOk = false; we'll still try PSI */
      } finally {
        clearTimeout(fetchTimer);
      }

      const extracted = fetchOk ? extractFromHtml(html, fullUrl) : {
        name: null, description: null, phones: [], emails: [], social: {},
        locality: null, region: null, canonical_url: fullUrl, platform_hint: null,
      };

      const derivedName = extracted.name ?? url.hostname.replace(/^www\./, "");
      const slug = slugify(derivedName);

      // ─── Run PSI (mobile only — desktop is optional) ─────────────────────────
      let psi: Awaited<ReturnType<typeof runPsiAudit>> | null = null;
      let psiError: string | null = null;
      if (runPsi) {
        try {
          psi = await runPsiAudit(fullUrl, "mobile", 75_000);
        } catch (e) {
          psiError = e instanceof Error ? e.message : String(e);
        }
      }

      // ─── Build prospect file ────────────────────────────────────────────────
      // The existence probe stays here only to shape the 409; the WRITE belongs to core/crm, which
      // owns it together with its event (see createProspect).
      const filePath = path.join(hitListDir(), `${slug}.md`);
      const exists = (await readTextFile(filePath)) !== null;
      if (exists && !body.overwrite) {
        return NextResponse.json(
          {
            ok: false,
            reason: "exists",
            slug,
            message: `Prospect "${slug}" already exists. Pass overwrite:true to replace.`,
          },
          { status: 409 }
        );
      }

      const websiteQuality = deriveWebsiteQuality(psi?.scores.performance ?? null);
      const location = locationString(extracted);
      const socialLines = Object.entries(extracted.social).filter(([, v]) => v).map(([k, v]) => `  - ${k}: ${v}`).join("\n");

      const lcpEmoji = (n: number | null) =>
        n === null ? "" : n <= 2500 ? " 🟢" : n <= 4000 ? " 🟡" : " 🔴";
      const clsEmoji = (n: number | null) =>
        n === null ? "" : n <= 0.1 ? " 🟢" : n <= 0.25 ? " 🟡" : " 🔴";
      const fcpEmoji = (n: number | null) =>
        n === null ? "" : n <= 1800 ? " 🟢" : n <= 3000 ? " 🟡" : " 🔴";

      const auditBlock = psi
        ? [
            "",
            "## Live PSI audit (run at intake)",
            "",
            fmtScoreLine("Performance (mobile)", psi.scores.performance, 90),
            fmtScoreLine("Accessibility", psi.scores.accessibility, 90),
            fmtScoreLine("Best Practices", psi.scores.best_practices, 90),
            fmtScoreLine("SEO", psi.scores.seo, 90),
            "",
            `**Core Web Vitals:**`,
            `- LCP: ${fmtMs(psi.cwv.lcp_ms)}${lcpEmoji(psi.cwv.lcp_ms)}`,
            `- FCP: ${fmtMs(psi.cwv.fcp_ms)}${fcpEmoji(psi.cwv.fcp_ms)}`,
            `- CLS: ${psi.cwv.cls ?? "—"}${clsEmoji(psi.cwv.cls)}`,
            `- TTFB: ${fmtMs(psi.cwv.ttfb_ms)}`,
            psi.opportunities.length > 0
              ? "\n**Top opportunities (potential time savings):**\n" +
                psi.opportunities
                  .slice(0, 5)
                  .map((o) => `- ${o.title}${o.savings_ms ? ` — save ~${fmtMs(o.savings_ms)}` : ""}`)
                  .join("\n")
              : "",
            "",
            ...(() => {
              const diag = diagnose(psi, extracted.platform_hint);
              return diag.length > 0
                ? ["## Diagnosis", "", ...diag.map((d) => `- ${d}`), ""]
                : [];
            })(),
            ...(() => {
              const angles = pitchAngles(psi, extracted.platform_hint, websiteQuality);
              return angles.length > 0
                ? [
                    "## Pitch angles (ranked)",
                    "",
                    ...angles.map((a, i) => `${i + 1}. ${a}`),
                    "",
                  ]
                : [];
            })(),
          ].filter(Boolean).join("\n")
        : psiError
          ? `\n## PSI audit\n\n_(failed at intake: ${psiError.replace(/\n/g, " ").slice(0, 200)})_\n`
          : "\n## PSI audit\n\n_(skipped at intake)_\n";

      const intelBlock = [
        "",
        "## Site intel (auto-extracted)",
        "",
        extracted.description ? `**Description:** ${extracted.description}` : "",
        extracted.platform_hint ? `**Platform:** ${extracted.platform_hint}` : "",
        extracted.canonical_url ? `**Canonical URL:** ${extracted.canonical_url}` : "",
        extracted.phones.length > 0 ? `**Phones from site:** ${extracted.phones.join(", ")}` : "",
        extracted.emails.length > 0 ? `**Emails from site:** ${extracted.emails.join(", ")}` : "",
        socialLines ? "**Social:**\n" + socialLines : "",
      ].filter(Boolean).join("\n");

      const fm = [
        `name: ${JSON.stringify(derivedName)}`,
        `business_type: ""`,
        `location: ${JSON.stringify(location)}`,
        `status: lead`,
        `website: ${JSON.stringify(fullUrl)}`,
        // OMITTED, NOT BLANKED, when no band was established (D-2). An absent key is what the
        // scorer, the reconciler and the CSV importer all already read as "unstated"; a blank or a
        // literal `null` would be a value, and `computeScore` would have to decide what it meant.
        ...(websiteQuality ? [`website_quality: ${websiteQuality}`] : []),
        `decision_maker_access: false`,
        `project_urgency: low`,
        `niche_alignment: false`,
        `contact_name: ""`,
        `contact_phone: ${JSON.stringify(extracted.phones[0] ?? "")}`,
        `contact_email: ${JSON.stringify(extracted.emails[0] ?? "")}`,
        `source: "URL intake (auto)"`,
        `first_contact: ""`,
        `last_contact: ""`,
      ].join("\n");

      const md = `---
${fm}
---

## Call Log
- ${new Date().toISOString().slice(0, 10)} — auto-added via URL intake. No contact yet.
${auditBlock}
${intelBlock}

## Friction / Notes
_Fill in qualitative observations after first contact._
`;

      // Delegated: core/crm performs the durable write and emits prospect.created exactly once —
      // on genuine creation only, never on an overwrite.
      await createProspect(slug, md, { overwrite: body.overwrite });

      return NextResponse.json({
        ok: true,
        slug,
        name: derivedName,
        website_quality: websiteQuality,
        psi_performance: psi?.scores.performance ?? null,
        psi_error: psiError,
        extracted: {
          platform: extracted.platform_hint,
          phones: extracted.phones,
          emails: extracted.emails,
          social_count: Object.keys(extracted.social).length,
          location,
        },
      });
    } catch (e) {
      return serverErrorResponse("prospects/from-url", e);
    }
  });
}
