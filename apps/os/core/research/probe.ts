// core/research/probe — DOES SOMETHING ANSWER AT THIS ADDRESS?
//
// ─── WHAT A PROBE CAN AND CANNOT ESTABLISH ─────────────────────────────────────────────────────
//
// It can establish ONE thing: that an HTTP request to this domain was answered by a server that
// returned a success status. That is enough to record `website` — a positive, checkable finding.
//
// It CANNOT establish that a business has no website. A request can fail because the site does not
// exist, and equally because DNS was slow, the host blocks datacentre traffic, the TLS handshake
// failed, the operator's network dropped, or the business is at a domain nobody guessed. Those are
// indistinguishable from here, which is exactly why `runner.ts` never converts a failed probe into
// `website_quality: 'none'`.
//
//   > A failure to find is not a finding of absence.
//
// ─── GET, NOT HEAD ─────────────────────────────────────────────────────────────────────────────
//
// HEAD is cheaper and a meaningful minority of small-business hosts answer it with 405 or 404 while
// serving GET perfectly. Since a false negative here becomes "no site found" in front of the
// operator, the cheaper request is the wrong trade. The body is discarded unread.

import "server-only";

export type ProbeOutcome = {
  readonly domain: string;
  /** True only for a 2xx/3xx answer from a real server. */
  readonly reachable: boolean;
  /** Where the request ended up after redirects — what gets recorded as the website. */
  readonly url: string | null;
  readonly status: number | null;
  /** Why it failed, for the evidence. Never shown as a claim about the business. */
  readonly error: string | null;
};

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Try one domain over https, then http.
 *
 * HTTPS FIRST because that is where a live site is; plain http second because a genuinely old
 * small-business site — the profile this pipeline is hunting — may still be http-only, and refusing
 * to look would systematically miss the most qualified prospects in the list.
 */
export async function probeDomain(
  domain: string,
  opts: { fetchImpl?: Fetcher; timeoutMs?: number } = {}
): Promise<ProbeOutcome> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as Fetcher);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  let lastError: string | null = null;

  for (const scheme of ["https", "http"] as const) {
    const url = `${scheme}://${domain}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        // Identifying the crawler is basic manners and makes the traffic explicable in someone
        // else's access log. It is not a disguise: nothing here pretends to be a browser.
        headers: { "user-agent": "AscendOS-Research/1.0 (+prospect website check)" },
      });
      if (res.status >= 200 && res.status < 400) {
        return { domain, reachable: true, url: res.url || url, status: res.status, error: null };
      }
      // A 4xx/5xx means a server answered and declined. That is NOT a reachable site, and it is also
      // not proof the business has none — it is recorded as what it is.
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : String(e);
    } finally {
      clearTimeout(timer);
    }
  }

  return { domain, reachable: false, url: null, status: null, error: lastError };
}
