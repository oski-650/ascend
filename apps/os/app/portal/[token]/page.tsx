import { notFound } from "next/navigation";
import { findInviteByToken } from "@/lib/portal";
import { listClients } from "@/lib/vault";
import { OnboardingForm } from "@/components/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function PortalOnboardingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await findInviteByToken(token);
  if (!invite) notFound();

  const clients = await listClients();
  const clientName = clients.find((c) => c.slug === invite.client_slug)?.name ?? invite.client_slug;

  return (
    <div>
      <header className="mb-6">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--color-fg-dim)]">
          welcome, {clientName}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[var(--color-fg)] sm:text-3xl">
          Let&apos;s get your project moving.
        </h1>
        <p className="mt-3 max-w-prose text-[var(--color-fg-mute)]">
          Six short sections. The first one (Goals &amp; Success) is the most important — the others fill in detail.
          You don&apos;t need to answer everything in one sitting; whatever you submit goes straight to us and we&apos;ll
          follow up on the rest during kickoff.
        </p>
      </header>

      <OnboardingForm token={token} clientName={clientName} />
    </div>
  );
}
