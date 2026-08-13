import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { hitListDir } from "@/lib/paths";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
