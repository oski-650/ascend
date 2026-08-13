import { NextResponse } from "next/server";
import { stopActive, stopEntry } from "@/lib/timeLog";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; note?: string };
    const entry = body.id ? await stopEntry(body.id, body.note) : await stopActive(body.note);
    if (!entry) {
      return NextResponse.json({ entry: null, message: "no active or matching entry" });
    }
    return NextResponse.json({ entry });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
