import { NextResponse } from "next/server";
import { findInviteByToken, getApprovalRequest, signApproval } from "@/lib/portal";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      token?: string;
      request_id?: string;
      by_name?: string;
      signature_text?: string;
    };
    if (!body.token || !body.request_id || !body.by_name || !body.signature_text) {
      return NextResponse.json(
        { error: "token, request_id, by_name, signature_text are required" },
        { status: 400 }
      );
    }
    const invite = await findInviteByToken(body.token);
    if (!invite) return NextResponse.json({ error: "invalid token" }, { status: 401 });

    const reqRecord = await getApprovalRequest(body.request_id);
    if (!reqRecord) return NextResponse.json({ error: "approval not found" }, { status: 404 });
    if (reqRecord.client_slug !== invite.client_slug) {
      return NextResponse.json({ error: "approval does not belong to this client" }, { status: 403 });
    }

    const signed = await signApproval({
      id: body.request_id,
      by_name: body.by_name,
      signature_text: body.signature_text,
    });
    return NextResponse.json({ approval_request: signed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
