// app/admin/import — THE CSV IMPORT SURFACE (2G.4.4, STAGE2G §29.3 Ruling 2).
//
// It was a `"use client"` page declaring `[]`, so a `sales` principal rendered it in full and a
// REVOKED principal did too (§29.6c) — a page that demands nothing never asks the question
// revocation is enforced at. The client component moved to `components/admin`, and the page became
// what its three guarded siblings already were.
//
// ─── IT COPES, IT DOES NOT AUTHORIZE ───────────────────────────────────────────────────────────
//
// `listImportFields()` requires `admin:*` at ITS boundary. This file calls it and renders what comes
// back, or lets `renderOrDenied` convert the refusal. No capability check lives here.

import type { Metadata } from "next";
import { listImportFields } from "@/core/admin/tools";
import { ImportProspectsPanel } from "@/components/admin/ImportProspectsPanel";
import { renderOrDenied } from "@/components/auth/renderOrDenied";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Import prospects · Ascend OS" };

async function ImportPageContent() {
  // ALONE, and first. §28.4 records F57 catching a `Promise.all` that let an unrelated rejection
  // outrun the denial; nothing may be awaited beside the authorized read.
  const fields = await listImportFields();
  return <ImportProspectsPanel fields={fields} />;
}

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function ImportPage(...props: Parameters<typeof ImportPageContent>) {
  return renderOrDenied("Bulk import", () => ImportPageContent(...props));
}
