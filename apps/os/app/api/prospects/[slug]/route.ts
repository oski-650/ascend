import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hitListDir } from "@/lib/paths";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return authorize(req, "prospects:identity", async () => {
    try {
      const { slug } = await params;
      if (!slug || slug.startsWith(".") || slug.includes("/") || slug.includes("\\")) {
        return NextResponse.json({ error: "invalid slug" }, { status: 400 });
      }
      const filePath = path.join(hitListDir(), `${slug}.md`);
      try {
        await fs.access(filePath);
      } catch {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      await fs.unlink(filePath);
      return NextResponse.json({ ok: true, deleted: slug });
    } catch (e) {
      return serverErrorResponse("prospects/[slug]", e);
    }
  });
}
