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
    name,
    description,
    phones,
    emails,
    social,
    locality,
    region,
    canonical_url,
    platform_hint,
  };
}

export function locationString(info: ExtractedSiteInfo): string {
  const parts = [info.locality, info.region].filter(Boolean);
  return parts.join(", ");
}
