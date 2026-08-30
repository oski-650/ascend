import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { dismissFiring } from "@/lib/automations";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return authorize(req, "pipeline:write", async () => {
    try {
      const body = (await req.json()) as {
        firing_id?: string;
        rule_id?: string;
        context?: Record<string, string | number>;
      };
      if (!body.firing_id || !body.rule_id) {
        return NextResponse.json({ error: "firing_id and rule_id are required" }, { status: 400 });
      }
      const entry = await dismissFiring(body.firing_id, body.rule_id, body.context ?? {});
      return NextResponse.json({ entry });
    } catch (e) {
      return serverErrorResponse("automations/dismiss", e);
    }
  });
}
