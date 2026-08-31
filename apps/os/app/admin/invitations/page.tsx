// app/admin/invitations — WHERE THE OWNER ISSUES A PARTNER INVITATION (2G.3, STAGE2G §28.4).
//
// ─── WHY A NEW PAGE RATHER THAN A PANEL ON `/admin` ────────────────────────────────────────────
//
// `admin`, `admin/import` and `admin/wipe` declare `[]` — they reach no guarded reader, so a sales
// principal RENDERS them. That is the finding parked for 2G.4, and §28.2 ruling 5 keeps it parked:
// hiding those pages would make the rail look right while the routes stayed as reachable as before.
//
// Putting the minting panel on one of them would have handed a sales principal a rendered invitation
// UI whose button fails at the route — a denial discovered by clicking. So the panel gets its own
// page, which reaches a GUARDED reader and therefore denies for the ordinary reason, through the
// ordinary mechanism. This adds a correctly-boundaried page; it does not touch the parked finding.
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
