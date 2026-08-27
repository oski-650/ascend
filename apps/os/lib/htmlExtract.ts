// Lightweight HTML-string extractor. Regex-based to avoid a DOM-parser dep.
// Only extracts patterns we trust: <title>, <meta>, tel:/mailto: hrefs, social-domain links.
// Returns ONLY what was actually found — never invents.

export type ExtractedSiteInfo = {
  name: string | null;
  description: string | null;
  phones: string[];
  emails: string[];
  social: {
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    yelp?: string;
    twitter?: string;
    tiktok?: string;
    youtube?: string;
  };
  locality: string | null;          // from og:locality / business:contact_data:locality
  region: string | null;            // og:region or similar
  canonical_url: string | null;
  platform_hint: string | null;     // best-guess from script src patterns
};

function firstMatch(html: string, rx: RegExp): string | null {
  const m = html.match(rx);
  return m ? m[1].trim() : null;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/**
 * Clean a value extracted from a REMOTE page before it is written into the vault.
 *
 * These values come from a third-party site's markup and are persisted into a prospect's markdown,
 * which is later rendered. lib/renderMarkdown is the authoritative XSS defence at render time; this
 * is defence-in-depth at the WRITE boundary so hostile markup never lands in the vault at all.
 *
 * It STRIPS rather than entity-escapes, so the stored note stays clean and readable in Obsidian
 * (escaping here would double-encode against the render-time escape and show `&lt;` to the operator).
 * Removes: any tag-like construct, control characters, and markdown/frontmatter-breaking newlines.
 */
/**
 * Decode the HTML character references that appear in extracted markup (D-4).
 *
 * WHY THIS MATTERS BEYOND COSMETICS. `<title>Tapia Tile &amp; Marble Co.</title>` was extracted
 * verbatim, so the vault holds `name: "Tapia Tile &amp; Marble Co."` — and because prospect
 * identity was `slugify(name)`, that markup leaked straight into the FILENAME as
 * `tapia-tile-amp-marble-co.md`. Two of six live prospects carry it. A display bug became an
 * identity bug because identity was derived from a display string.
 *
 * DECODE ORDER IS LOAD-BEARING: `&amp;` is decoded LAST. Decoding it first would turn the encoded
 * text `&amp;lt;script&amp;gt;` into `&lt;script&gt;` and then into `<script>` — re-forming the
 * markup that `cleanText` strips. Numeric references are likewise resolved before `&amp;`, and any
 * character they produce is still subject to the tag-stripping that follows.
 */
function decodeHtmlEntities(value: string): string {
  const NAMED: Record<string, string> = {
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
    "&#39;": "'",
    "&nbsp;": " ",
    "&ndash;": "–",
    "&mdash;": "—",
    "&rsquo;": "’",
    "&lsquo;": "‘",
    "&rdquo;": "”",
    "&ldquo;": "“",
    "&hellip;": "…",
  };
  let out = value;
  for (const [entity, char] of Object.entries(NAMED)) {
    out = out.replace(new RegExp(entity, "gi"), char);
  }
  // Numeric references, decimal and hex. Control characters are dropped rather than emitted; the
  // cleanup below would strip them anyway, and resolving them here keeps the intent explicit.
  out = out.replace(/&#(\d+);/g, (_m, d: string) => {
    const code = Number(d);
    return Number.isFinite(code) && code >= 32 ? String.fromCodePoint(code) : " ";
  });
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => {
    const code = parseInt(h, 16);
    return Number.isFinite(code) && code >= 32 ? String.fromCodePoint(code) : " ";
  });
  return out.replace(/&amp;/gi, "&");
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const cleaned = decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, "") // tag-like constructs
    .replace(/[<>]/g, "") // stray angle brackets that could re-form a tag
    .replace(/[\x00-\x1F\x7F]/g, " ") // control chars, incl. newlines that would break frontmatter
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return cleaned.length > 0 ? cleaned : null;
}

export function extractFromHtml(html: string, sourceUrl: string): ExtractedSiteInfo {
  // ─── name candidates (prefer og:site_name → og:title → <title>) ──────────
  const ogSiteName = firstMatch(
    html,
    /<meta\s+[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  const ogTitle = firstMatch(
    html,
    /<meta\s+[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i
  );
  const title = firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i);
  let name = ogSiteName ?? ogTitle ?? title ?? null;
  if (name) {
    // Common pattern: "Brand · Tagline" or "Brand | Tagline" — try to keep the brand part.
    const split = name.split(/\s+[·|—–-]\s+/).map((s) => s.trim()).filter(Boolean);
    if (split.length > 1) {
      // Pick the longest part that ISN'T just an acronym (short + all-caps).
      // Falls back to first part if everything looks acronym-y.
      const candidates = split.filter((p) => !(p.length <= 5 && /^[A-Z0-9.&-]+$/.test(p)));
      if (candidates.length > 0) {
        // Prefer the longest non-acronym candidate
        name = candidates.reduce((a, b) => (b.length > a.length ? b : a));
      } else {
        name = split[0];
      }
    }
    name = name.replace(/\s+/g, " ").trim();
  }

  // ─── description ──────────────────────────────────────────────────────────
  const description =
    firstMatch(
      html,
      /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i
    ) ??
    firstMatch(
      html,
      /<meta\s+[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i
    );

  // ─── phones (from tel: hrefs) ─────────────────────────────────────────────
  const phones = uniq(
    Array.from(html.matchAll(/href=["']tel:([^"']+)["']/gi), (m) => m[1].replace(/^tel:/, "").trim())
  ).slice(0, 3);

  // ─── emails (from mailto: hrefs) ──────────────────────────────────────────
  const emails = uniq(
    Array.from(html.matchAll(/href=["']mailto:([^"'?]+)/gi), (m) => m[1].trim().toLowerCase())
  ).slice(0, 3);

  // ─── social links ─────────────────────────────────────────────────────────
  const social: ExtractedSiteInfo["social"] = {};
  const socialPatterns: { key: keyof ExtractedSiteInfo["social"]; rx: RegExp }[] = [
    { key: "facebook", rx: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'?#]+)/i },
    { key: "instagram", rx: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'?#]+)/i },
    { key: "linkedin", rx: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/[^"'?#]+)/i },
    { key: "yelp", rx: /href=["'](https?:\/\/(?:www\.)?yelp\.com\/[^"'?#]+)/i },
    { key: "twitter", rx: /href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'?#]+)/i },
    { key: "tiktok", rx: /href=["'](https?:\/\/(?:www\.)?tiktok\.com\/[^"'?#]+)/i },
    { key: "youtube", rx: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/[^"'?#]+)/i },
  ];
  for (const { key, rx } of socialPatterns) {
    const v = firstMatch(html, rx);
    if (v) social[key] = v;
  }

  // ─── locality / region (Open Graph business profile) ──────────────────────
  const locality =
    firstMatch(
      html,
      /<meta\s+[^>]*property=["']business:contact_data:locality["'][^>]*content=["']([^"']+)["'][^>]*>/i
    ) ??
    firstMatch(html, /<meta\s+[^>]*property=["']og:locality["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  const region =
    firstMatch(
      html,
      /<meta\s+[^>]*property=["']business:contact_data:region["'][^>]*content=["']([^"']+)["'][^>]*>/i
    ) ??
    firstMatch(html, /<meta\s+[^>]*property=["']og:region["'][^>]*content=["']([^"']+)["'][^>]*>/i);

  // ─── canonical URL ────────────────────────────────────────────────────────
  const canonical_url =
    firstMatch(html, /<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) ??
    sourceUrl;

  // ─── platform hint ────────────────────────────────────────────────────────
  let platform_hint: string | null = null;
  if (/wixstatic\.com|wix\.com|wix-static/i.test(html)) platform_hint = "Wix";
  else if (/cdn\.shopify\.com|shopify\.com|x-shopify/i.test(html)) platform_hint = "Shopify";
  else if (/squarespace\.com|sqsp\.com/i.test(html)) platform_hint = "Squarespace";
  else if (/wp-content|wp-includes|wordpress/i.test(html)) platform_hint = "WordPress";
  else if (/_next\/static|__NEXT_DATA__/i.test(html)) platform_hint = "Next.js";
  else if (/webflow\.com|webflow\.io/i.test(html)) platform_hint = "Webflow";
  else if (/duda\.co|dudaone/i.test(html)) platform_hint = "Duda";

  return {
    name: cleanText(name),
    description: cleanText(description),
    phones: phones.map((p) => cleanText(p) ?? "").filter(Boolean),
    emails: emails.map((e) => cleanText(e) ?? "").filter(Boolean),
    social,
    locality: cleanText(locality),
    region: cleanText(region),
    canonical_url,
    platform_hint,
  };
}

export function locationString(info: ExtractedSiteInfo): string {
  const parts = [info.locality, info.region].filter(Boolean);
  return parts.join(", ");
}
