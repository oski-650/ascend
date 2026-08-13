import { NextResponse } from "next/server";
import { appendAudit, type AuditStrategy } from "@/lib/audits";
import { runPsiAudit } from "@/lib/lighthouse";
import { validateExternalUrl } from "@/lib/urlGuard";

export const dynamic = "force-dynamic";
// PSI calls can be slow — extend the route's max duration.
export const maxDuration = 90;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      client?: string;
      url?: string;
      strategy?: AuditStrategy;
    };
    if (!body.client || !body.url || !body.strategy) {
      return NextResponse.json(
        { error: "client, url, and strategy are required" },
        { status: 400 }
      );
    }
    if (body.strategy !== "mobile" && body.strategy !== "desktop") {
      return NextResponse.json(
        { error: "strategy must be 'mobile' or 'desktop'" },
        { status: 400 }
      );
    }
    // The URL is forwarded to the PageSpeed API. Google performs the fetch, so this is not a direct
    // SSRF path — but validating here keeps internal hostnames out of a third-party service and
    // rejects unfetchable targets before spending an API quota call.
    const guarded = await validateExternalUrl(body.url);
    if (!guarded.ok) {
      return NextResponse.json({ error: guarded.reason }, { status: 400 });
    }

    const result = await runPsiAudit(guarded.url.toString(), body.strategy, 80_000);
    const audit = await appendAudit({
      client: body.client,
      url: result.fetched_url ?? body.url,
      strategy: body.strategy,
      run_at: new Date().toISOString(),
      scores: result.scores,
      cwv: result.cwv,
      opportunities: result.opportunities,
      source: "psi",
    });
    return NextResponse.json({ audit });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("aborted") ? 504 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
