import { notFound } from "next/navigation";
import { findInviteByToken } from "@/lib/portal";
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

  // The token authorizes THIS invite record and nothing else. The display name was snapshotted at
  // issuance by an authorized operator, so this page queries no client store at all — there is no
  // lookup here that could widen to another client. Legacy invites predate the snapshot and fall
  // back to the slug, which is what this page always displayed when a name was missing.
  const clientName = invite.client_name ?? invite.client_slug;

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
