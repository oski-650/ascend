import { NextResponse } from "next/server";
import { createNewVersion } from "@/lib/documents";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const doc = await createNewVersion(id);
    if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ document: doc });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
