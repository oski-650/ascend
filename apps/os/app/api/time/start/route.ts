import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { startEntry } from "@/lib/timeLog";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return authorize(req, "time:*", async () => {
    try {
      const body = (await req.json()) as { client?: string; phase?: string; task?: string; note?: string };
      if (!body.client || !body.phase || !body.task) {
        return NextResponse.json(
          { error: "client, phase, and task are required" },
          { status: 400 }
        );
      }
      const entry = await startEntry({
        client: body.client,
        phase: body.phase,
        task: body.task,
        note: body.note,
      });
      return NextResponse.json({ entry });
    } catch (e) {
      return serverErrorResponse("time/start", e);
    }
  });
}
