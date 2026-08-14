import Link from "next/link";
import { routeForEntity } from "@/navigation/routing";

/**
 * Legacy card on the (not-yet-redesigned) /crm index. Its DESTINATION is resolved through the
 * canonical routing owner so the index cannot become a second client destination — the styling is
 * still legacy, but every "open client" in the product now lands on the same view.
 */
export function ClientCard({ slug, name }: { slug: string; name: string }) {
  return (
    <Link
      href={routeForEntity("client", slug) ?? `/crm/${slug}`}
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
