// app/api/console/search — read-only search backing the ⌘K palette.
//
// It introduces NO new search architecture. It is a thin transport over the two deterministic
// matchers that already own this behavior:
//   • objects  → core/knowledge.buildKnowledgeIndex() → packages/search.query()
//   • commands → core/command-runtime.listCommands()  → packages/commands.matchCommands()
// Entity → route resolution stays with navigation/routing, the single owner.
//
// GET is READ-ONLY and never executes a command: it returns metadata only. Mutations continue to
// run through the existing preview → explicit POST confirm gate in core/command-runtime.
//
// ─── THE ONE ROUTE WHERE A 403 WOULD BE THE WRONG ANSWER (STAGE2F §9) ──────────────────────────
//
// Search is not a domain a role either has or does not have. Both roles search; what differs is
// what comes back. Denying `sales` outright would break the palette for the person who most needs
// it, and — worse — it would teach the codebase that route-level denial is how this class of leak
// gets handled. It is not: a capability check on the ROUTE returns a perfectly authorized 200 full
// of client names.
//
// So `sales` gets **200**, and the scoping happens where the results are ASSEMBLED — in
// core/knowledge, which does not read the excluded material at all. This route filters nothing and
// no longer even converts the principal into a visibility: since 2G.1 slice 4 the assembly boundary
// resolves the asking principal ITSELF, so there is no argument through which any caller — this one
// included — could assert an authority it does not hold.

import { NextResponse } from "next/server";
import { buildKnowledgeIndex } from "@/core/knowledge";
import { query } from "@/packages/search";
import { matchCommands } from "@/packages/commands";
import { listCommands } from "@/core/command-runtime";
import { objectHref } from "@/navigation/routing";
import { focusHrefFor } from "@/graph-view/contract";
import { authorize } from "@/lib/route-guard";

export const dynamic = "force-dynamic";

const LIMIT = 8;

export async function GET(request: Request) {
  return authorize(request, "search", async (principal) => {
    // `new URL(request.url)` rather than `NextRequest.nextUrl`: the handler then works against an
    // ordinary Request, which is what lets the security suite issue real requests to it directly.
    const term = (new URL(request.url).searchParams.get("q") ?? "").trim();

    if (term.length === 0) {
      return NextResponse.json({ objects: [], commands: [] });
    }

    try {
      // The principal decides which entity kinds are even discovered — resolved inside the
      // assembly boundary, from this request's context. A `sales` request never opens a client
      // file, so no client can appear in `objects` — by construction rather than by filter.
      const index = await buildKnowledgeIndex();

      const objects = query(index.search, term)
        .slice(0, LIMIT)
        .map((result) => ({
          id: result.id,
          entity: result.entity,
          title: result.title,
          href: objectHref(result),
          // Both destinations are resolved HERE, by the two canonical owners: navigation/routing for
          // the detail route, the graph contract for graph identity. The palette receives finished
          // hrefs and constructs neither, so no second routing table or graph model exists on the
          // client. `null` where the entity has no detail route / cannot be a node.
          focusHref: focusHrefFor(result.entity, result.id),
        }));

      // Commands are metadata about what the OS can do, not business data — no client names, no
      // amounts, no prospect content. They are not scoped, and that is a decision: a command a
      // caller lacks the capability to run still fails at ITS route.
      const commands = matchCommands(listCommands(), term)
        .slice(0, LIMIT)
        .map(({ metadata }) => ({
          id: metadata.id,
          label: metadata.label,
          description: metadata.description,
          kind: metadata.kind,
        }));

      return NextResponse.json({ objects, commands });
    } catch {
      // A missing/unreadable vault must not surface a stack trace to the client.
      return NextResponse.json({ objects: [], commands: [], error: "Search unavailable" }, { status: 200 });
    }
  });
}
