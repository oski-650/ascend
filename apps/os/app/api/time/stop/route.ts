import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { stopActive, stopEntry } from "@/lib/timeLog";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return authorize(req, "time:*", async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as { id?: string; note?: string };
      const entry = body.id ? await stopEntry(body.id, body.note) : await stopActive(body.note);
      if (!entry) {
        return NextResponse.json({ entry: null, message: "no active or matching entry" });
      }
      return NextResponse.json({ entry });
    } catch (e) {
      return serverErrorResponse("time/stop", e);
    }
  });
}
