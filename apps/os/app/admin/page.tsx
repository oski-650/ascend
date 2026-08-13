import Link from "next/link";

export const dynamic = "force-dynamic";

const TOOLS = [
  {
    href: "/admin/import",
    title: "Bulk Import Prospects",
    desc: "Paste a CSV export from Google Sheets / Numbers; map columns; one markdown file per row written to 02 - Sales & Hit List/.",
    accent: "var(--color-accent)",
    safe: true,
  },
  {
    href: "/admin/wipe",
    title: "Wipe Demo Data",
    desc: "Clear transactional sidecars (invoices, time log, audits, etc.) and seeded sample documents. Transitions OS from demo state to live.",
    accent: "var(--color-danger)",
    safe: false,
  },
];

export default function AdminPage() {
  return (
    <div>
      <div className="mb-6 border-b border-[var(--color-border-hi)] pb-4">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">admin</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">System Tools</h1>
        <p className="mt-2 max-w-prose text-sm text-[var(--color-fg-mute)]">
          Internal utilities for managing vault data. Use carefully — the wipe tool is destructive and there&apos;s no undo
          short of restoring from iCloud version history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`block rounded-lg border bg-[var(--color-surface)] p-5 transition-colors hover:bg-[var(--color-surface-hi)] ${
              t.safe
                ? "border-[var(--color-border-hi)] hover:border-[var(--color-accent)]"
                : "border-[var(--color-danger)]/40 hover:border-[var(--color-danger)]"
            }`}
          >
            <h2
              className="mb-1 text-base font-semibold sm:text-lg"
              style={{ color: t.safe ? "var(--color-fg)" : "var(--color-danger)" }}
            >
              {t.title}
            </h2>
            <p className="text-sm text-[var(--color-fg-mute)]">{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
