// app/api/prospects/[slug]/followups/[followupId] — the OWNER's edit of an OPEN follow-up (Slice 2A.1c,
// 2A.1b decision 1). `prospects:manage`.
//
// Not an "edit anything" endpoint: `expected` is the follow-up as the owner saw it (compare-and-set),
// `changes` may name only action, assignee, dueOn, dueAt and note, the due time goes through the
// canonical Los Angeles resolver, and a resolved follow-up cannot be edited at all.

import { serverErrorResponse } from "@/lib/apiError";
import { authorize } from "@/lib/route-guard";
import { BadRequest, badRequest, parseFollowUpEditBody, readJson, salesResponse } from "@/lib/sales-http";
import { editFollowUp } from "@/core/crm/sales";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ slug: string; followupId: string }> }) {
  return authorize(req, "prospects:manage", async () => {
    try {
      const { slug, followupId } = await params;
      const body = parseFollowUpEditBody(await readJson(req)) as { commandId: string; expected: never; changes: never };
      return salesResponse(await editFollowUp(slug, { ...body, followupId }));
    } catch (e) {
      if (e instanceof BadRequest) return badRequest(e);
      return serverErrorResponse("prospects/[slug]/followups/[followupId]", e);
    }
  });
}
