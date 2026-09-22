// app/api/prospects/[slug]/actions — the mobile SAVE: contact · optional self-claim · optional stage ·
// optional follow-up, as ONE atomic command (Slice 2A.1c). `prospects:write`.
//
// This handler decides nothing about sales. It parses a STRICT body (no actor, role, author or
// prospect field exists to spoof — naming one is a 400), passes the resolved principal's command to
// `saveSalesAction`, and maps the result through the frozen contract in `lib/sales-http`. The command
// id is the client's, reused unchanged on every retry: a retry after a lost response returns 200 with
// the SAME outcome, and nothing is written twice.

import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { BadRequest, badRequest, parseSaveBody, readJson, salesResponse } from "@/lib/sales-http";
import { saveSalesAction } from "@/core/crm/sales";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:write", async () => {
    try {
      const { slug } = await params;
      return salesResponse(await saveSalesAction(slug, parseSaveBody(await readJson(req))));
    } catch (e) {
      if (e instanceof BadRequest) return badRequest(e);
      return serverErrorResponse("prospects/[slug]/actions", e);
    }
  });
}
