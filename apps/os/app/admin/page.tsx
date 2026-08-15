// app/admin — THE CONTROL LAYER.
//
// Deliberately the plainest surface in the OS. Admin is where irreversible things live, so it is
// given no visual energy at all: no metrics, no status, no accent color except on the one action
// that can destroy data. A control panel that looks exciting encourages clicking.
//
// Two entries, each stating plainly what it does and whether it can be undone.

import Link from "next/link";
import type { Metadata } from "next";
import { PageShell, SectionLabel, SurfaceHeader } from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin · Ascend OS" };

const TOOLS = [
  {
    href: "/admin/import",
    title: "Bulk import prospects",
    desc: "Paste a CSV export, map its columns, and write one markdown file per row into 02 - Sales & Hit List/.",
    consequence: "Additive — writes new prospect files, changes nothing that exists.",
    destructive: false,
  },
  {
    href: "/admin/wipe",
    title: "Wipe demo data",
    desc: "Clear the transactional sidecars — invoices, time log, audits, approvals — and the seeded sample documents.",
    consequence: "Irreversible. There is no undo short of iCloud version history.",
    destructive: true,
  },
];

export default function AdminPage() {
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
          {TOOLS.map((t) => (
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