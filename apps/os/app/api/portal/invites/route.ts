import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { createInvite, listInvites, revokeInvite } from "@/lib/portal";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return authorize(req, "portal:admin", async () => {
    try {
      const url = new URL(req.url);
      const client = url.searchParams.get("client") ?? undefined;
      const all = await listInvites();
      const filtered = client ? all.filter((i) => i.client_slug === client) : all;
      return NextResponse.json({ invites: filtered });
    } catch (e) {
      return serverErrorResponse("portal/invites", e);
    }
  });
}

export async function POST(req: Request) {
  return authorize(req, "portal:admin", async () => {
    try {
      const body = (await req.json()) as { client?: string; label?: string; revoke_id?: string };
      if (body.revoke_id) {
        const inv = await revokeInvite(body.revoke_id);
        if (!inv) return NextResponse.json({ error: "not found" }, { status: 404 });
        return NextResponse.json({ invite: inv });
      }
      if (!body.client) return NextResponse.json({ error: "client is required" }, { status: 400 });
      const invite = await createInvite(body.client, body.label);
      return NextResponse.json({ invite });
    } catch (e) {
      return serverErrorResponse("portal/invites", e);
    }
  });
}
