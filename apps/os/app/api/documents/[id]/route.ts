import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { updateStatus, DOCUMENT_STATUSES, type DocumentStatus } from "@/lib/documents";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return authorize(req, "documents:*", async () => {
    try {
      const { id } = await params;
      const body = (await req.json()) as { status?: string };
      if (!body.status || !DOCUMENT_STATUSES.includes(body.status as DocumentStatus)) {
        return NextResponse.json(
          { error: `status required, one of ${DOCUMENT_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }
      const doc = await updateStatus(id, body.status as DocumentStatus);
      if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ document: doc });
    } catch (e) {
      return serverErrorResponse("documents/[id]", e);
    }
  });
}
