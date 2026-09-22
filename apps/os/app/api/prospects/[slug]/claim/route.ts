// app/api/prospects/[slug]/claim — claim an UNASSIGNED prospect for oneself (Slice 2A.1c). `prospects:write`.
//
// The body is `{ commandId }` and nothing else: there is no field naming whom to assign, because a
// claim assigns the resolved principal and no one else — here, in the domain command, and again in
// `ascend_assign_prospect`. A second claim by the holder answers `already_yours`; anyone else's
// answers 409 `already_assigned`.

import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { BadRequest, badRequest, parseClaimBody, readJson, salesResponse } from "@/lib/sales-http";
import { claimProspect } from "@/core/crm/sales";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:write", async () => {
    try {
      const { slug } = await params;
      const { commandId } = parseClaimBody(await readJson(req));
      return salesResponse(await claimProspect(slug, commandId));
    } catch (e) {
      if (e instanceof BadRequest) return badRequest(e);
      return serverErrorResponse("prospects/[slug]/claim", e);
    }
  });
}
