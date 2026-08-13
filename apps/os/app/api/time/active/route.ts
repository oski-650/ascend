import { NextResponse } from "next/server";
import { getActiveEntry } from "@/lib/timeLog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const active = await getActiveEntry();
    return NextResponse.json({ active });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
