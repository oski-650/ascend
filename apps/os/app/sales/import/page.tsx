// app/sales/import — THE CSV IMPORT SURFACE (moved here by 2G.4.7).
//
// ─── TWO MOVES, AND THE SECOND UNDID HALF OF THE FIRST ─────────────────────────────────────────
//
// It was `app/admin/import`, a `"use client"` page declaring `[]`, so a `sales` principal rendered
// it in full and a REVOKED principal did too (§29.6c) — a page that demands nothing never asks the
// question revocation is enforced at. 2G.4.4 fixed that by guarding all three `/admin` pages
// together with `admin:*`.
//
// Correct for the disclosure, wrong for this page. Bulk import creates PROSPECTS, and its route has
// always been mapped to `import:run`. When 2G.4.7 granted the sales partner that capability, the
// page would have been a business tool stranded behind the one capability he is denied — reachable
// through the API, invisible in the product. So it moved to the surface that owns prospects, and its
// boundary is the one its own route already used.
//
// ─── `/sales/import` SHADOWS `/sales/[prospect]` FOR THE SLUG "import" ─────────────────────────
//
// A static segment wins over a sibling dynamic one, so a prospect whose slug is literally `import`
// would be unreachable at its own URL. Accepted rather than overlooked: the alternative is a
// reserved-word check on every prospect slug, which is a larger rule than the case deserves.
//
// ─── IT COPES, IT DOES NOT AUTHORIZE ───────────────────────────────────────────────────────────
//
// `listImportFields()` requires `import:run` at ITS boundary. This file calls it and renders what comes
// back, or lets `renderOrDenied` convert the refusal. No capability check lives here.

import type { Metadata } from "next";
import { listImportFields } from "@/core/crm/import";
import { ImportProspectsPanel } from "@/components/sales/ImportProspectsPanel";
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
