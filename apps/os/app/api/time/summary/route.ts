import { NextResponse } from "next/server";
import { summarizeByClient, summaryFor } from "@/lib/timeLog";
import { computeEhr, getClientRevenue } from "@/lib/ehr";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
