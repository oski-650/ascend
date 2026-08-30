import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { PHASE_KEYS, type PhaseKey } from "@/domain";
import { toggleChecklistItem } from "@/core/production";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return authorize(req, "production:toggle", async () => {
    try {
      const body = (await req.json()) as { client?: string; phase?: string; itemIndex?: number };
      if (!body.client || !body.phase || typeof body.itemIndex !== "number") {
        return NextResponse.json({ error: "client, phase, and itemIndex are required" }, { status: 400 });
      }
      if (!(PHASE_KEYS as readonly string[]).includes(body.phase)) {
        return NextResponse.json({ error: `phase must be one of ${PHASE_KEYS.join(", ")}` }, { status: 400 });
      }
      if (body.itemIndex < 0) {
        return NextResponse.json({ error: "itemIndex must be >= 0" }, { status: 400 });
      }

      const result = await toggleChecklistItem(body.client, body.phase as PhaseKey, body.itemIndex);
      if (!result.ok) {
        return NextResponse.json({ error: result.message }, { status: 404 });
      }

      return NextResponse.json({
        done: result.done,
        changed: result.changed,
        client: body.client,
        phase: body.phase,
        itemIndex: body.itemIndex,
      });
    } catch (e) {
      return serverErrorResponse("production/toggle", e);
    }
  });
}
