import Link from "next/link";

export function ClientCard({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={`/crm/${slug}`}
      className="group flex flex-col justify-between rounded-lg border border-[var(--color-border-hi)] bg-[var(--color-surface)] p-4 transition-all hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-hi)]"
    >
      <div className="flex items-start justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">client</span>
        <span className="size-1.5 rounded-full bg-[var(--color-fg-dim)] group-hover:bg-[var(--color-accent)]" />
      </div>
      <h3 className="mt-6 text-base font-semibold text-[var(--color-fg)] sm:text-lg">{name}</h3>
      <p className="mt-1 font-mono text-xs text-[var(--color-fg-dim)]">{slug}</p>
    </Link>
  );
}
