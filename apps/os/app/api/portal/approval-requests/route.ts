import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { createApprovalRequest, listApprovalRequests } from "@/lib/portal";
import { APPROVAL_KINDS, type ApprovalKind } from "@/lib/portalTypes";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const client = url.searchParams.get("client") ?? undefined;
    const reqs = await listApprovalRequests(client);
    return NextResponse.json({ approval_requests: reqs });
  } catch (e) {
    return serverErrorResponse("portal/approval-requests", e);
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      client?: string;
      kind?: string;
      title?: string;
      description?: string;
      due_at?: string;
    };
    if (!body.client) return NextResponse.json({ error: "client required" }, { status: 400 });
    if (!body.kind || !APPROVAL_KINDS.includes(body.kind as ApprovalKind)) {
      return NextResponse.json(
        { error: `kind required, one of ${APPROVAL_KINDS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });

    const out = await createApprovalRequest({
      clientSlug: body.client,
      kind: body.kind as ApprovalKind,
      title: body.title,
      description: body.description ?? "",
      due_at: body.due_at,
    });
    return NextResponse.json({ approval_request: out });
  } catch (e) {
    return serverErrorResponse("portal/approval-requests", e);
  }
}
