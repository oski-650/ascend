import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { listAudits } from "@/lib/audits";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return authorize(req, "audits:*", async () => {
    try {
      const url = new URL(req.url);
      const client = url.searchParams.get("client") ?? undefined;
      const audits = await listAudits(client);
      return NextResponse.json({ audits });
    } catch (e) {
      return serverErrorResponse("audits", e);
    }
  });
}
