import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { logEntry } from "@/lib/timeLog";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      client?: string;
      phase?: string;
      task?: string;
      started?: string;
      duration_seconds?: number;
      note?: string;
    };

    if (!body.client || !body.phase || !body.task) {
      return NextResponse.json(
        { error: "client, phase, and task are required" },
        { status: 400 }
      );
    }
    if (!body.started) {
      return NextResponse.json({ error: "started (ISO) is required" }, { status: 400 });
    }
    const started = new Date(body.started);
    if (isNaN(started.getTime())) {
      return NextResponse.json({ error: "started is not a valid ISO date" }, { status: 400 });
    }
    if (typeof body.duration_seconds !== "number" || body.duration_seconds <= 0) {
      return NextResponse.json(
        { error: "duration_seconds must be a positive number" },
        { status: 400 }
      );
    }

    const entry = await logEntry({
      client: body.client,
      phase: body.phase,
      task: body.task,
      started,
      durationSeconds: Math.round(body.duration_seconds),
      note: body.note,
    });
    return NextResponse.json({ entry });
  } catch (e) {
    return serverErrorResponse("time/log", e);
  }
}
