import { NextResponse } from "next/server";
import {
  createSubmission,
  findInviteByToken,
  saveUploadedFile,
} from "@/lib/portal";
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, type UploadedFileRef } from "@/lib/portalTypes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const token = form.get("token");
    if (typeof token !== "string" || !token) {
      return NextResponse.json({ error: "token required" }, { status: 400 });
    }
    const invite = await findInviteByToken(token);
    if (!invite) return NextResponse.json({ error: "invalid token" }, { status: 401 });

    // Pluck files vs text fields. Files come in under "files[]" (array).
    const fields: Record<string, string> = {};
    const fileObjs: File[] = [];
    let totalBytes = 0;
    for (const [key, val] of form.entries()) {
      if (key === "token") continue;
      if (val instanceof File) {
        if (val.size === 0) continue; // skip empty file slots
        if (val.size > MAX_FILE_BYTES) {
          return NextResponse.json(
            { error: `File "${val.name}" exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB limit` },
            { status: 413 }
          );
        }
        totalBytes += val.size;
        if (totalBytes > MAX_TOTAL_BYTES) {
          return NextResponse.json(
            { error: `Total upload exceeds ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit` },
            { status: 413 }
          );
        }
        fileObjs.push(val);
      } else if (typeof val === "string") {
        fields[key] = val;
      }
    }

    // Write files to vault
    const refs: UploadedFileRef[] = [];
    for (const f of fileObjs) {
      refs.push(await saveUploadedFile(invite.client_slug, f));
    }

    const submission = await createSubmission({
      clientSlug: invite.client_slug,
      inviteId: invite.id,
      fields,
      files: refs,
    });
    return NextResponse.json({ submission });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
