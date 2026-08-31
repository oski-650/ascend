// app/invite/[token] — where a partner sets their own password (2G.2, STAGE2G §27).
//
// ─── IT LOOKS NOTHING UP ───────────────────────────────────────────────────────────────────────
//
// The token is in the URL and this page NEVER validates it server-side. That is deliberate: a page
// that checked the token would have to say something about the result, and "this invitation is
// invalid" versus a rendered form is exactly the enumeration oracle §27 forbids. Every token renders
// the same form; only the POST decides, and it answers one way for all four failure reasons.
//
// It therefore reaches no data-access boundary and demands no capability — `[]` in the page
// authorization map, and F54 holds it to that: this page cannot authorize, and does not try.

import { AcceptInvitationForm } from "@/components/auth/AcceptInvitationForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Set your password · Ascend OS" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="mx-auto max-w-md px-6 py-24">
      <p className="t-label mb-3 text-[var(--color-t3)]">Ascend OS</p>
      <h1 className="mb-4 text-2xl font-medium text-[var(--color-t1)]">Set your password</h1>
      <p className="mb-8 text-sm text-[var(--color-t2)]">
        Choose a password of at least 12 characters. This link works once.
      </p>
      <AcceptInvitationForm token={token} />
    </div>
  );
}
