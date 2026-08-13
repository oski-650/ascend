import { NextResponse } from "next/server";
import { markPaid, markUnpaid } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { paid?: boolean; paid_at?: string };
    if (body.paid === false) {
      const invoice = await markUnpaid(id);
      if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ invoice });
    }
    // Default: mark paid (with optional paid_at override)
    const when = body.paid_at ? new Date(body.paid_at) : undefined;
    if (when && isNaN(when.getTime())) {
      return NextResponse.json({ error: "paid_at must be valid ISO date" }, { status: 400 });
    }
    const invoice = await markPaid(id, when);
    if (!invoice) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ invoice });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
