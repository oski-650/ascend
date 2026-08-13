// lib/urlGuard.ts — SSRF guard for operator-supplied URLs (hardening pass).
//
// SCOPE: validates that a URL is safe for the server to fetch. No read-model, no derivation, no
// vault access, no frozen contract. Used by the prospect URL-intake route, which previously fetched
// any URL server-side with no scheme or host restriction — reaching loopback (including Ascend OS's
// own API), RFC1918, and cloud link-local metadata endpoints, then persisting the response into the
// vault and echoing parts of it back in the response body.
//
// Defence is in two parts, because either alone is bypassable:
//   • Scheme/shape check — http(s) only, no embedded credentials.
//   • DNS resolution + address classification — the hostname's ACTUAL resolved addresses must all be
//     public. A literal IP, a hostname that resolves to 127.0.0.1, and a DNS-rebinding candidate are
//     all caught here rather than by a blocklist of names.
// Redirects are followed MANUALLY (see safeFetch) so that every hop is re-validated; a public host
// redirecting to a private one is the classic bypass of a fetch-time-only check.

import { lookup } from "node:dns/promises";

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/** Parse `input`, defaulting a bare host to https, and reject anything not fetchable-safe by shape. */
export function parseAndValidateShape(input: string): UrlGuardResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: "url is empty" };

  let url: URL;
  try {
    url = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "only http and https URLs are allowed" };
  }
  // Credentials in the URL would be forwarded to whatever we fetch.
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed" };
  }
  if (!url.hostname) return { ok: false, reason: "URL has no host" };

  return { ok: true, url };
}

function ipv4IsPublic(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;

  if (a === 0) return false; // 0.0.0.0/8 "this network"
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local — includes cloud metadata 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT RFC6598
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking RFC2544
  if (a >= 224) return false; // multicast (224/4) + reserved (240/4) + broadcast
  return true;
}

function ipv6IsPublic(addr: string): boolean {
  const a = addr.toLowerCase().split("%")[0]; // strip zone id
  if (a === "::" || a === "::1") return false; // unspecified / loopback

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible — classify the embedded IPv4 instead.
  const mapped = a.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPublic(mapped[1]);

  if (a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb")) return false; // fe80::/10 link-local
  if (a.startsWith("fc") || a.startsWith("fd")) return false; // fc00::/7 unique-local
  if (a.startsWith("ff")) return false; // ff00::/8 multicast
  if (a.startsWith("64:ff9b")) return false; // NAT64
  return true;
}

export function addressIsPublic(addr: string, family: number): boolean {
  return family === 4 ? ipv4IsPublic(addr) : ipv6IsPublic(addr);
}

/**
 * Resolve `hostname` and require EVERY returned address to be public. Resolving all addresses
 * (rather than just the first) prevents a host that publishes both a public and a private record
 * from slipping through.
 */
export async function hostResolvesPublicly(hostname: string): Promise<UrlGuardResult | null> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: "host could not be resolved" };
  }
  if (addresses.length === 0) return { ok: false, reason: "host could not be resolved" };

  for (const { address, family } of addresses) {
    if (!addressIsPublic(address, family)) {
      return { ok: false, reason: "host resolves to a private, loopback, or link-local address" };
    }
  }
  return null; // null ⇒ no objection
}

/** Full validation: shape, then DNS classification. */
export async function validateExternalUrl(input: string): Promise<UrlGuardResult> {
  const shape = parseAndValidateShape(input);
  if (!shape.ok) return shape;

  const objection = await hostResolvesPublicly(shape.url.hostname);
  if (objection) return objection;

  return { ok: true, url: shape.url };
}

export type SafeFetchResult =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; reason: string };

/**
 * Fetch `startUrl`, re-validating the target at every redirect hop.
 *
 * `redirect: "manual"` is essential: with automatic following, only the FIRST URL would be checked
 * and a public host could redirect straight to 169.254.169.254. Each Location is resolved against
 * the current URL and re-run through validateExternalUrl before the next request.
 */
export async function safeFetch(
  startUrl: URL,
  init: RequestInit & { signal?: AbortSignal },
  maxRedirects = 3
): Promise<SafeFetchResult> {
  let current = startUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current.toString(), { ...init, redirect: "manual" });

    const isRedirect = response.status >= 300 && response.status < 400 && response.headers.has("location");
    if (!isRedirect) return { ok: true, response, finalUrl: current.toString() };

    if (hop === maxRedirects) return { ok: false, reason: "too many redirects" };

    const location = response.headers.get("location") as string;
    let next: URL;
    try {
      next = new URL(location, current); // relative Locations are legal
    } catch {
      return { ok: false, reason: "invalid redirect location" };
    }

    const check = await validateExternalUrl(next.toString());
    if (!check.ok) return { ok: false, reason: `redirect blocked: ${check.reason}` };
    current = check.url;
  }

  return { ok: false, reason: "too many redirects" };
}