// app/admin/invitations — WHERE THE OWNER ISSUES A PARTNER INVITATION (2G.3, STAGE2G §28.4).
//
// ─── WHY A NEW PAGE RATHER THAN A PANEL ON `/admin` ────────────────────────────────────────────
//
// WHEN THIS PAGE WAS WRITTEN (2G.3), `admin`, `admin/import` and `admin/wipe` declared `[]` — they
// reached no guarded reader, so a sales principal RENDERED them. That was parked finding 1, and
// §28.2 ruling 5 kept it parked rather than hiding the pages, which would have made the rail look
// right while the routes stayed as reachable as before.
//
// Putting the minting panel on one of them would have handed a sales principal a rendered invitation
// UI whose button fails at the route — a denial discovered by clicking. So the panel got its own
// page, which reaches a GUARDED reader and therefore denies for the ordinary reason.
//
// 2G.4.4 CLOSED the parked finding: all three siblings now demand `admin:*` through
// `core/admin/tools`, so this page is no longer the exception among them. The reasoning above is
// kept because it is why this page exists and where it lives, not because the state it describes is
// still current.
//
// ─── IT COPES, IT DOES NOT AUTHORIZE ───────────────────────────────────────────────────────────
//
// `listOrganizationMembers()` requires `admin:*` at ITS boundary. This file calls it and renders
// what comes back, or lets `renderOrDenied` convert the refusal. No capability check lives here.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { listOrganizationMembers } from "@/core/auth/directory";
import { InvitePartnerPanel } from "@/components/InvitePartnerPanel";
import { renderOrDenied } from "@/components/auth/renderOrDenied";
import { PageShell, SectionLabel, SurfaceHeader } from "@/components/primitives/entity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Invitations · Ascend OS" };

async function InvitationsPageContent() {
  // ─── THE ORDER IS LOAD-BEARING, AND F57 CAUGHT IT ────────────────────────────────────────────
  //
  // These two were a `Promise.all`. `headers()` throws outside a request scope, and a rejected
  // `Promise.all` settles on whichever rejection lands first — so a sales principal could receive
  // the framework's error instead of the denial, and `renderOrDenied` correctly rethrows anything
  // that is not a `CapabilityDenied`. The refusal would have been real and invisible.
  //
  // Same shape as the C2 finding in slice 4: a rejected `Promise.all` cannot cancel its siblings.
  // The authorized read therefore goes FIRST, alone, and nothing else can outrun its answer.
  const members = await listOrganizationMembers();
  const headerList = await headers();

  // Reconstruct the site origin so the link is usable off this machine — same derivation the client
  // portal's share links use.
  const host = headerList.get("host") ?? "localhost:3001";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;

  return (
    <PageShell>
      <SurfaceHeader
        eyebrow="System"
        title="Invitations"
        lede="Issue a one-time link that lets somebody who already has an account set their password."
      />

      <SectionLabel>Issue a link</SectionLabel>
      <InvitePartnerPanel candidates={members} baseUrl={baseUrl} />

      <SectionLabel>What this does not do</SectionLabel>
      <p className="max-w-[60ch] text-sm text-[var(--color-t2)]">
        An invitation never creates a person and never grants a role. It sets a password for an
        account that already exists, with a membership someone provisioned outside this screen.
        Accepting one changes nothing about what that person may see.
      </p>
    </PageShell>
  );
}

/** THE DENIAL BOUNDARY. It authorizes nothing — see components/auth/renderOrDenied. */
export default async function InvitationsPage(
  ...props: Parameters<typeof InvitationsPageContent>
) {
  return renderOrDenied("Invitations", () => InvitationsPageContent(...props));
}
