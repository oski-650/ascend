import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { summarizeByClient, summaryFor } from "@/lib/timeLog";
import { computeEhr, getClientRevenue } from "@/lib/ehr";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return authorize(req, "time:*", async () => {
    try {
      const url = new URL(req.url);
      const client = url.searchParams.get("client");
      if (client) {
        const summary = await summaryFor(client);
        if (!summary) return NextResponse.json({ summary: null, ehr: null, revenue_usd: null });
        const revenue = await getClientRevenue(client);
        const ehr = computeEhr(revenue, summary.total_seconds);
        return NextResponse.json({ summary, ehr, revenue_usd: revenue });
      }
      const all = await summarizeByClient();
      return NextResponse.json({ summary: all });
    } catch (e) {
      return serverErrorResponse("time/summary", e);
    }
  });
}
