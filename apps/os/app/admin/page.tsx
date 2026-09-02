// app/admin — THE CONTROL LAYER.
//
// Deliberately the plainest surface in the OS. Admin is where irreversible things live, so it is
// given no visual energy at all: no metrics, no status, no accent color except on the one action
// that can destroy data. A control panel that looks exciting encourages clicking.
//
// ─── 2G.4.4: IT NOW DEMANDS `admin:*`, LIKE THE THINGS IT LINKS TO ─────────────────────────────
//
// It declared `[]` and reached no reader, so a `sales` principal rendered the index of destructive
// tools — and §29.6c measured the second half of that: a REVOKED principal rendered it too, because
// a page demanding nothing never makes the request revocation is enforced at. `listAdminTools()`
// requires `admin:*` at ITS boundary; this file calls it and renders what comes back, or lets
// `renderOrDenied` convert the refusal. No capability check lives here.

import Link from "next/link";
import type { Metadata } from "next";
import { listAdminTools } from "@/core/admin/tools";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { PageShell, SectionLabel, SurfaceHeader } from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin · Ascend OS" };

async function AdminPageContent() {
  // ALONE, and first — see the sibling note in app/admin/import/page.tsx.
  const tools = await listAdminTools();

  return (
    // No node hue: Admin is not an entity in the graph, and giving it one would imply it is.
    <PageShell>
      <SurfaceHeader
        eyebrow="System"
        title="Admin"
        lede="Utilities that act on the vault directly. Everything here bypasses the normal flow — read the consequence line before using one."
      />

      <section>
        <SectionLabel tier="quiet">Tools</SectionLabel>
        <ul className="flex flex-col">
          {tools.map((t) => (
            <li key={t.href} className="border-b border-[var(--color-line)] last:border-b-0">
              <Link
                href={t.href}
                className="-mx-3 block rounded-[var(--radius-sm)] px-3 py-5 transition-colors duration-[120ms] hover:bg-[var(--color-surface-2)]"
              >
                <h2
                  className="t-h2"
                  style={{ color: t.destructive ? "var(--color-risk)" : "var(--color-t1)" }}
                >
                  {t.title}
                </h2>
                <p className="t-body mt-1.5 max-w-[68ch] text-[var(--color-t2)]">{t.desc}</p>
                {/* The consequence is stated in words, not encoded in a border color. */}
                <p
                  className="t-mono mt-2"
                  style={{ color: t.destructive ? "var(--color-risk)" : "var(--color-t3)" }}
                >
                  {t.consequence}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <p className="t-mono mt-10 text-[var(--color-t3)]">
        Sidecar state lives in <span className="text-[var(--color-t2)]">.ascend-os/</span> inside the
        vault. Vault content itself is never touched by these tools.
      </p>
    </PageShell>
  );
}

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function AdminPage(...props: Parameters<typeof AdminPageContent>) {
  return renderOrDenied("Admin", () => AdminPageContent(...props));
}
