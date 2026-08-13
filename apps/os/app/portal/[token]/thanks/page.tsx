import Link from "next/link";

export default async function ThanksPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-6 text-center sm:p-10">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-2xl text-[var(--color-accent)]">
        ✓
      </div>
      <h1 className="text-xl font-semibold text-[var(--color-fg)] sm:text-2xl">Got it — thank you.</h1>
      <p className="mx-auto mt-3 max-w-md text-[var(--color-fg-mute)]">
        Your submission is in. The Ascend team will review and reach out within 48 hours with next steps.
      </p>
      <Link
        href={`/portal/${token}`}
        className="mt-6 inline-block rounded-md border border-[var(--color-border-hi)] bg-transparent px-4 py-2 text-sm font-semibold text-[var(--color-fg-mute)] hover:border-[var(--color-fg-mute)] hover:text-[var(--color-fg)]"
      >
        Submit something else
      </Link>
    </div>
  );
}
