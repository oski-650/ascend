import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { createNewVersion } from "@/lib/documents";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorize(req, "documents:*", async () => {
    try {
      const { id } = await params;
      const doc = await createNewVersion(id);
      if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ document: doc });
    } catch (e) {
      return serverErrorResponse("documents/[id]/version", e);
    }
  });
}
