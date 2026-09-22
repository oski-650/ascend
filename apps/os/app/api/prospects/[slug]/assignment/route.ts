// app/api/prospects/[slug]/assignment — REASSIGN or UNASSIGN, owner/admin only (Slice 2A.1c). `prospects:manage`.
//
// Owner-only at three layers: this route's capability (`prospects:manage`, which sales does not hold), the
// domain command, and `ascend_assign_prospect`, which reads the actor's membership role itself.
// Compare-and-set on `expectedAssignee`; an open follow-up requires an explicit `openFollowUp` choice
// (leave · transfer · cancel) — ownership of the prospect never silently moves the follow-up.

import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { BadRequest, badRequest, parseAssignmentBody, readJson, salesResponse } from "@/lib/sales-http";
import { changeAssignment } from "@/core/crm/sales";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:manage", async () => {
    try {
      const { slug } = await params;
      return salesResponse(await changeAssignment(slug, parseAssignmentBody(await readJson(req))));
    } catch (e) {
      if (e instanceof BadRequest) return badRequest(e);
      return serverErrorResponse("prospects/[slug]/assignment", e);
    }
  });
}
