// app/api/prospects/[slug]/research — look for this prospect's website.
//
// It validates, authorizes, calls ONE function, and reports. Which addresses are worth trying, what
// a probe can establish, and the rule that a miss writes nothing all live in `core/research`.
//
// ─── `research:run`, NOT `prospects:write` ─────────────────────────────────────────────────────
//
// The same reasoning `import:run` carries: this makes OUTBOUND REQUESTS to third parties from the
// operator's machine, which editing a prospect never does, so it is a separate act with a separate
// blast radius. Both human roles hold it today; a narrower role later can be denied it without
// revisiting what `prospects:write` means.
//
// The write itself happens as `ascend_automation`, one layer down — a role that CANNOT write a
// judgment. See `core/research/website`.

import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { researchProspectWebsite, ProspectNotFound } from "@/core/research/website";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "research:run", async () => {
    try {
      const { slug } = await params;
      const result = await researchProspectWebsite(slug);
      return NextResponse.json({ ok: true, result });
    } catch (e) {
      if (e instanceof ProspectNotFound) {
        return NextResponse.json({ error: "no such prospect" }, { status: 404 });
      }
      return serverErrorResponse("prospects/[slug]/research", e);
    }
  });
}
