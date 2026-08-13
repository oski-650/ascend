import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { findInviteByToken } from "@/lib/portal";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
    const invite = await findInviteByToken(token);
    if (!invite) return NextResponse.json({ invite: null }, { status: 404 });
    return NextResponse.json({ invite });
  } catch (e) {
    return serverErrorResponse("portal/me", e);
  }
}
