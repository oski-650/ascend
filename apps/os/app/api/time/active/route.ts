import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { getActiveEntry } from "@/lib/timeLog";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return authorize(req, "time:*", async () => {
    try {
      const active = await getActiveEntry();
      return NextResponse.json({ active });
    } catch (e) {
      return serverErrorResponse("time/active", e);
    }
  });
}
