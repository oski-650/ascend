// app/partner — RETIRED (2A.3c, owner decision Q2a).
//
// It was the partner's landing surface (2G.3), built when a sales principal signing in landed on a
// denial at `/`. 2G.4.7 made the partner owner-minus-admin, so both roles land on the Galaxy, and
// this page became a second, unbounded pipeline beside `/sales`: every prospect, rendered in one
// list, reached from its own nav entry next to "Pipeline". One place to work is `/sales`.
//
// The route is kept as a redirect, the retired `/search` precedent, so bookmarks still resolve. It
// reaches no reader, so it demands nothing (`PAGE_AUTHORIZATION["partner"]` is `[]`) and inherits
// the boundary of `/sales`, which denies for the ordinary reason. `?scope=` is forwarded when it
// names a `/sales` scope; nothing else is.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PartnerPage({
  searchParams,
}: {
  searchParams?: Promise<{ scope?: string | string[] }>;
}) {
  const { scope } = (await searchParams) ?? {};
  redirect(scope === "mine" || scope === "team" ? `/sales?scope=${scope}` : "/sales");
}
