import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/vault";
import { compileContext } from "@/lib/compileContext";
import { ProfileSection, MetaSection } from "@/components/ProfileSection";
import { CopyContextButton } from "./CopyContextButton";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const payload = compileContext(client);

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <Link href="/crm" className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          ← all clients
        </Link>
        <Link href={`/production/${client.slug}`} className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          · production
        </Link>
        <Link href={`/crm/${client.slug}/portal`} className="font-mono text-xs text-[var(--color-fg-dim)] hover:text-[var(--color-fg-mute)]">
          · portal
        </Link>
      </div>

      <div className="sticky top-[57px] z-40 -mx-4 mb-6 border-b border-[var(--color-border-hi)] bg-[var(--color-bg)]/85 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">client · {client.slug}</p>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{client.name}</h1>
          </div>
          <CopyContextButton payload={payload} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProfileSection title="Business Context" section={client.business} />
        <ProfileSection title="Brand Identity" section={client.brand} />
        <ProfileSection title="Project Scope" section={client.scope} />
        <MetaSection data={client.meta.data} missing={client.meta.missing} />
      </div>
    </div>
  );
}
