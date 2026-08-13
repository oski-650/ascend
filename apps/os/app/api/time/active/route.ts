import { NextResponse } from "next/server";
import { serverErrorResponse } from "@/lib/apiError";
import { getActiveEntry } from "@/lib/timeLog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const active = await getActiveEntry();
    return NextResponse.json({ active });
  } catch (e) {
    return serverErrorResponse("time/active", e);
  }
}
