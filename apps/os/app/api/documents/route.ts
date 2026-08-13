import { NextResponse } from "next/server";
import {
  listDocuments,
  createDocument,
  DOCUMENT_TYPES,
  type DocumentType,
  type DocumentStatus,
} from "@/lib/documents";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const docs = await listDocuments({
      client: url.searchParams.get("client") ?? undefined,
      type: (url.searchParams.get("type") as DocumentType | null) ?? undefined,
      status: (url.searchParams.get("status") as DocumentStatus | null) ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      includeSuperseded: url.searchParams.get("include_superseded") === "1",
    });
    return NextResponse.json({ documents: docs });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      type?: string;
      client?: string;
      title?: string;
      summary?: string;
      amount_usd?: number;
      body?: string;
    };
    if (!body.type || !DOCUMENT_TYPES.includes(body.type as DocumentType)) {
      return NextResponse.json(
        { error: `type required, must be one of ${DOCUMENT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!body.client) return NextResponse.json({ error: "client is required" }, { status: 400 });
    if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });

    const rec = await createDocument({
      type: body.type as DocumentType,
      client: body.client,
      title: body.title,
      summary: body.summary,
      amount_usd: typeof body.amount_usd === "number" ? body.amount_usd : undefined,
      body: body.body,
    });
    return NextResponse.json({ document: rec });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
