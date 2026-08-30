import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { listInvoices, createInvoice } from "@/lib/finance";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return authorize(req, "finance:*", async () => {
    try {
      const invoices = await listInvoices();
      return NextResponse.json({ invoices });
    } catch (e) {
      return serverErrorResponse("finance/invoices", e);
    }
  });
}

export async function POST(req: Request) {
  return authorize(req, "finance:*", async () => {
    try {
      const body = (await req.json()) as {
        client?: string;
        amount_usd?: number;
        label?: string;
        issued_at?: string;
        due_at?: string;
        paid_at?: string | null;
        note?: string;
      };

      if (!body.client) return NextResponse.json({ error: "client is required" }, { status: 400 });
      if (typeof body.amount_usd !== "number" || body.amount_usd <= 0)
        return NextResponse.json({ error: "amount_usd must be a positive number" }, { status: 400 });
      if (!body.label) return NextResponse.json({ error: "label is required" }, { status: 400 });
      if (!body.issued_at || !body.due_at)
        return NextResponse.json({ error: "issued_at and due_at are required (ISO)" }, { status: 400 });

      const issued = new Date(body.issued_at);
      const due = new Date(body.due_at);
      const paid = body.paid_at ? new Date(body.paid_at) : null;
      if (isNaN(issued.getTime()) || isNaN(due.getTime()))
        return NextResponse.json({ error: "issued_at / due_at must be valid ISO dates" }, { status: 400 });

      const invoice = await createInvoice({
        client: body.client,
        amount_usd: body.amount_usd,
        label: body.label,
        issued_at: issued,
        due_at: due,
        paid_at: paid,
        note: body.note,
      });
      return NextResponse.json({ invoice });
    } catch (e) {
      return serverErrorResponse("finance/invoices", e);
    }
  });
}
